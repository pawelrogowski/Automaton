import { parentPort, workerData } from 'worker_threads';
import { createRequire } from 'module';
import { captureImage } from '../screenMonitor/screenGrabUtils/captureImage.js';
import { findSequences } from '../screenMonitor/screenGrabUtils/findSequences.js';
import {
  regionColorSequences,
  resourceBars,
  cooldownColorSequences,
  statusBarSequences,
  battleListSequences,
  actionBarItems,
} from '../constants/index.js';
import { findBoundingRect } from '../screenMonitor/screenGrabUtils/findBoundingRect.js';
import { calculatePartyEntryRegions } from '../screenMonitor/calcs/calculatePartyEntryRegions.js';
import calculatePartyHpPercentage from '../screenMonitor/calcs/calculatePartyHpPercentage.js';
import RuleProcessor from './screenMonitor/ruleProcessor.js';
import findAllOccurrences from '../screenMonitor/screenGrabUtils/findAllOccurences.js';
import calculatePercentages from '../screenMonitor/calcs/calculatePercentages.js';
import { PARTY_MEMBER_STATUS } from './screenMonitor/constants.js';
import { CooldownManager } from './screenMonitor/CooldownManager.js';

const require = createRequire(import.meta.url);
const windowinfo = require(workerData.windowInfoPath);
const { X11Capture } = require(workerData.x11capturePath);

class ScreenMonitorWorker {
  constructor() {
    this.state = null;
    this.initialized = false;
    this.shouldRestart = false;
    this.dimensions = null;
    this.lastDimensions = null;
    this.isResizing = false;
    this.resizeStabilizeTimeout = null;
    this.RESIZE_STABILIZE_DELAY = 250;
    this.imageBuffer = null;
    this.fullWindowImageData = null;
    this.startRegions = null;
    this.hpManaRegion = null;
    this.cooldownsRegion = null;
    this.statusBarRegion = null;
    this.minimapRegion = null;
    this.battleListRegion = null;
    this.partyListRegion = null;
    this.cooldownBarRegions = null;
    this.statusBarRegions = null;
    this.foundActionItems = null;
    this.actionBarsRegion = null;
    this.hpbar = null;
    this.mpbar = null;
    this.lastMinimapImageData = null;
    this.lastDispatchedHealthPercentage = null;
    this.lastDispatchedManaPercentage = null;
    this.lastMinimapChangeTime = null;
    this.minimapChanged = false;

    this.config = {
      logLevel: 'silent',
      clearConsole: false,
      captureRegions: {
        hpMana: { enabled: true },
        cooldowns: { enabled: true },
        statusBar: { enabled: true },
        battleList: { enabled: true },
        partyList: { enabled: true },
        minimap: { enabled: true },
        actionBars: { enabled: false },
      },
      processing: {
        checkDimensions: true,
        trackMinimap: true,
        monitorCooldowns: true,
        handleParty: true,
      },
    };

    this.MINIMAP_CHANGE_INTERVAL = 128;
    this.DIMENSION_CHECK_INTERVAL = 250;
    this.lastDimensionCheck = Date.now();

    this.captureInstance = new X11Capture();
    this.cooldownManager = new CooldownManager();
    this.ruleProcessorInstance = new RuleProcessor();

    parentPort.on('message', (updatedState) => {
      this.state = updatedState;
    });
  }

  async start() {
    while (true) {
      const iterationStart = Date.now();
      try {
        await this.mainLoopIteration();
      } catch (err) {
        console.error(err);
      } finally {
        const executionTime = Date.now() - iterationStart;
        const delayTime = this.calculateDelayTime(executionTime);
        await this.delay(delayTime);
      }
    }
  }

  async mainLoopIteration() {
    try {
      if (this.needsInitialization()) {
        await this.initializeRegions();
      }

      if (this.initialized) {
        this.checkDimensionsRegularly();
        const capturedData = await this.captureAndProcessRegions();
        this.processCapturedData(capturedData);

        if (this.validateDimensions()) {
          if (this.state?.global?.botEnabled) {
            this.runRules(capturedData);
          }
          this.handleHealthAndManaUpdates(capturedData);
        } else {
          this.shouldRestart = true;
        }

        if (this.config.processing.trackMinimap) {
          this.handleMinimapChange(capturedData.minimap);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  needsInitialization() {
    return (!this.initialized && this.state?.global?.windowId && this.state?.global?.refreshRate) || this.shouldRestart;
  }

  validateDimensions() {
    if (!this.state?.global?.windowId) return false;

    const currentDimensions = windowinfo.getDimensions(this.state.global.windowId);
    const isValid =
      this.dimensions && currentDimensions.width === this.dimensions.width && currentDimensions.height === this.dimensions.height;

    if (!isValid) {
      this.handleResizeStart(currentDimensions);
    }
    return isValid;
  }

  handleResizeStart(newDimensions) {
    this.dimensions = newDimensions;
    this.lastDimensions = newDimensions;

    if (this.resizeStabilizeTimeout) clearTimeout(this.resizeStabilizeTimeout);
    parentPort.postMessage({
      notification: {
        title: 'Screen Monitor Warning',
        body: 'Window Size Changed',
      },
    });
    this.resizeStabilizeTimeout = setTimeout(() => {
      this.initialized = false;
      this.shouldRestart = true;
    }, this.RESIZE_STABILIZE_DELAY);
  }

  async initializeRegions() {
    this.resetRegions();
    this.dimensions = windowinfo.getDimensions(this.state.global.windowId);
    this.lastDimensions = this.dimensions;

    this.fullWindowImageData = await captureImage(
      this.state.global.windowId,
      { x: 0, y: 0, width: this.dimensions.width, height: this.dimensions.height },
      this.captureInstance,
    );

    this.startRegions = findSequences(this.fullWindowImageData, regionColorSequences, null, 'first', false);
    this.initializeStandardRegions();
    this.initializeSpecialRegions();

    this.initialized = true;
    this.shouldRestart = false;

    // Notify about the status of region initialization
    this.notifyInitializationStatus();
  }

  resetRegions() {
    this.hpManaRegion = null;
    this.cooldownsRegion = null;
    this.statusBarRegion = null;
    this.minimapRegion = null;
    this.battleListRegion = null;
    this.partyListRegion = null;
    this.cooldownBarRegions = null;
    this.statusBarRegions = null;
    this.actionBarsRegion = null;
  }

  initializeStandardRegions() {
    const { healthBar, manaBar, cooldownBar, cooldownBarFallback, statusBar, minimap } = this.startRegions;
    this.hpbar = healthBar;
    this.mpbar = manaBar;

    this.hpManaRegion = this.createRegion(healthBar, 94, 14);
    this.cooldownsRegion = this.createRegion(cooldownBar || cooldownBarFallback, 56, 4);
    this.statusBarRegion = this.createRegion(statusBar, 104, 9);
    this.minimapRegion = this.createRegion(minimap, 106, 1);
  }

  createRegion(bar, width, height) {
    return bar?.x !== undefined ? { x: bar.x, y: bar.y, width, height } : null;
  }

  initializeSpecialRegions() {
    if (this.config.captureRegions.battleList.enabled) {
      const battleRegion = this.findBoundingRegion(regionColorSequences.battleListStart, regionColorSequences.battleListEnd);
      this.battleListRegion = this.validateRegionDimensions(battleRegion) ? battleRegion : null;
    }

    if (this.config.captureRegions.partyList.enabled) {
      const partyRegion = this.findBoundingRegion(regionColorSequences.partyListStart, regionColorSequences.partyListEnd);
      this.partyListRegion = this.validateRegionDimensions(partyRegion) ? partyRegion : null;
    }

    if (this.config.captureRegions.actionBars.enabled) {
      const actionBarRegion = this.findBoundingRegion(
        regionColorSequences.hotkeyBarBottomStart,
        regionColorSequences.hotkeyBarBottomEnd,
        this.dimensions.width,
        this.dimensions.height,
      );
      this.actionBarsRegion = this.validateRegionDimensions(actionBarRegion) ? actionBarRegion : null;
    }
  }

  validateRegionDimensions(region) {
    return region?.x !== undefined && region.width > 0 && region.height > 0;
  }

  findBoundingRegion(startSequence, endSequence, width = 169, height = this.dimensions.height) {
    try {
      const result = findBoundingRect(this.fullWindowImageData, startSequence, endSequence, width, height);
      return result.startFound && result.endFound && result.width > 0 && result.height > 0 ? result : null;
    } catch (error) {
      console.error('Error in findBoundingRegion:', error);
      return null;
    }
  }

  notifyInitializationStatus() {
    const status = {
      hpManaRegion: !!this.hpManaRegion,
      cooldownsRegion: !!this.cooldownsRegion,
      statusBarRegion: !!this.statusBarRegion,
      minimapRegion: !!this.minimapRegion,
      battleListRegion: !!this.battleListRegion,
      partyListRegion: !!this.partyListRegion,
      actionBarsRegion: !!this.actionBarsRegion,
    };

    let message = '';
    for (const [region, found] of Object.entries(status)) {
      message += `${region}: ${found ? '✅' : '❌'}\n`;
    }

    parentPort.postMessage({
      notification: {
        title: 'Monitor Status',
        body: message,
      },
    });
  }

  checkDimensionsRegularly() {
    if (Date.now() - this.lastDimensionCheck > this.DIMENSION_CHECK_INTERVAL) {
      this.lastDimensionCheck = Date.now();
      this.validateDimensions();
    }
  }

  async captureAndProcessRegions() {
    const { regionsToGrab, regionTypes } = this.prepareRegionsForCapture();
    const grabResults = await Promise.all(
      regionsToGrab.map((region) => captureImage(this.state.global.windowId, region, this.captureInstance)),
    );

    return this.createCapturedDataMap(grabResults, regionTypes);
  }

  prepareRegionsForCapture() {
    const regionsToGrab = [];
    const regionTypes = [];

    const regions = [
      { type: 'hpMana', region: this.hpManaRegion },
      { type: 'cooldowns', region: this.cooldownsRegion },
      { type: 'statusBar', region: this.statusBarRegion },
      { type: 'battleList', region: this.battleListRegion },
      { type: 'partyList', region: this.partyListRegion },
      { type: 'minimap', region: this.minimapRegion },
      { type: 'actionBars', region: this.actionBarsRegion },
    ];

    regions.forEach(({ type, region }) => {
      if (this.config.captureRegions[type]?.enabled && this.validateRegionDimensions(region)) {
        regionsToGrab.push(region);
        regionTypes.push(type);
      }
    });

    if (this.config.captureRegions.partyList.enabled) {
      this.addPartyRegions(regionsToGrab, regionTypes);
    }

    return { regionsToGrab, regionTypes };
  }

  addPartyRegions(regionsToGrab, regionTypes) {
    if (this.partyListRegion?.x !== undefined) {
      const partyEntryRegions = calculatePartyEntryRegions(this.partyListRegion, Math.floor(this.partyListRegion.height / 26));

      partyEntryRegions.forEach((entry, index) => {
        if (entry.bar?.x !== undefined) {
          regionsToGrab.push(entry.bar);
          regionTypes.push(`partyEntryBar_${index}`);
        }
        if (entry.name?.x !== undefined) {
          regionsToGrab.push(entry.name);
          regionTypes.push(`partyEntryName_${index}`);
        }
      });
    }
  }

  createCapturedDataMap(grabResults, regionTypes) {
    const capturedData = {};
    grabResults.forEach((result, index) => {
      capturedData[regionTypes[index]] = result;
    });
    return capturedData;
  }

  processCapturedData(capturedData) {
    // First check critical HP/mana capture
    if (this.config.captureRegions.hpMana.enabled && !capturedData.hpMana) {
      this.shouldRestart = true;
      return;
    }

    // Then process other non-critical regions
    if (this.config.processing.trackMinimap) {
      this.handleMinimapChange(capturedData.minimap);
    }
    if (this.config.captureRegions.cooldowns.enabled) {
      this.updateCooldowns(capturedData.cooldowns);
    }
    if (this.config.captureRegions.statusBar.enabled) {
      this.processStatusBars(capturedData.statusBar);
    }
    if (this.config.captureRegions.actionBars.enabled) {
      this.processActionBars(capturedData.actionBars);
    }
  }

  handleMinimapChange(minimapData) {
    if (!minimapData) return;

    if (this.lastMinimapImageData) {
      const minimapIsDifferent = Buffer.compare(minimapData, this.lastMinimapImageData) !== 0;
      if (minimapIsDifferent) {
        this.minimapChanged = true;
        this.lastMinimapChangeTime = Date.now();
      } else if (this.lastMinimapChangeTime && Date.now() - this.lastMinimapChangeTime > this.MINIMAP_CHANGE_INTERVAL) {
        this.minimapChanged = false;
      }
    }
    this.lastMinimapImageData = minimapData;
  }

  updateCooldowns(cooldownsData) {
    if (!this.config.processing.monitorCooldowns) return;

    this.cooldownBarRegions = cooldownsData
      ? findSequences(cooldownsData, cooldownColorSequences)
      : { healing: { x: undefined }, support: { x: undefined }, attack: { x: undefined } };
  }

  processStatusBars(statusBarData) {
    this.statusBarRegions = statusBarData ? findSequences(statusBarData, statusBarSequences) : {};
  }

  processActionBars(actionBarsData) {
    this.foundActionItems = actionBarsData ? findSequences(actionBarsData, actionBarItems) : {};
  }

  runRules(capturedData) {
    // Default values if regions aren't captured
    const hpManaData = capturedData.hpMana || null;
    const battleListData = capturedData.battleList || null;
    const partyListData = capturedData.partyList || null;

    const { newHealthPercentage, newManaPercentage } = this.calculateHealthAndMana(hpManaData);
    const characterStatus = this.getCharacterStatus();
    const battleListEntries = this.getBattleListEntries(battleListData);
    const partyData = this.config.processing.handleParty ? this.getPartyData(partyListData) : [];

    // Default cooldownBarRegions if not found
    const cooldownDefaults = { healing: { x: undefined }, support: { x: undefined }, attack: { x: undefined } };
    const cooldownBarRegions = this.cooldownBarRegions || cooldownDefaults;

    if (cooldownBarRegions.attackInactive?.x !== undefined) {
      this.cooldownManager.forceDeactivate('attack');
    }
    if (cooldownBarRegions.healingInactive?.x !== undefined) {
      this.cooldownManager.forceDeactivate('healing');
    }
    if (cooldownBarRegions.supportInactive?.x !== undefined) {
      this.cooldownManager.forceDeactivate('support');
    }

    this.ruleProcessorInstance.processRules(
      this.state.healing.presets[this.state.healing.activePresetIndex],
      {
        hpPercentage: newHealthPercentage,
        manaPercentage: newManaPercentage,
        healingCdActive: this.cooldownManager.updateCooldown('healing', cooldownBarRegions.healing?.x !== undefined),
        supportCdActive: this.cooldownManager.updateCooldown('support', cooldownBarRegions.support?.x !== undefined),
        attackCdActive: this.cooldownManager.updateCooldown('attack', cooldownBarRegions.attack?.x !== undefined),
        characterStatus,
        monsterNum: battleListEntries.length || 0, // Ensure 0 if empty
        isWalking: this.minimapChanged,
        partyMembers: partyData || [], // Ensure empty array if undefined
      },
      this.state.global,
    );
  }

  calculateHealthAndMana(hpManaData) {
    return {
      newHealthPercentage: calculatePercentages(this.hpbar, this.hpManaRegion, hpManaData, resourceBars.healthBar),
      newManaPercentage: calculatePercentages(this.mpbar, this.hpManaRegion, hpManaData, resourceBars.manaBar),
    };
  }

  getCharacterStatus() {
    const status = {};
    for (const key of Object.keys(statusBarSequences)) {
      status[key] = this.statusBarRegions?.[key]?.x !== undefined;
    }
    return status;
  }

  getBattleListEntries(battleListData) {
    return battleListData ? findAllOccurrences(battleListData, battleListSequences.battleEntry) : [];
  }

  getPartyData(partyListData) {
    if (!partyListData || !this.partyListRegion) return [];

    const partyData = [];
    const partyEntryRegions = calculatePartyEntryRegions(this.partyListRegion, Math.floor(this.partyListRegion.height / 26));

    for (let i = 0; i < partyEntryRegions.length; i++) {
      const entry = partyEntryRegions[i];
      const hpPercentage = this.calculatePartyHp(partyListData, entry.bar);
      const isActive = this.checkPartyMemberStatus(partyListData, entry.name);

      if (hpPercentage >= 0) {
        partyData.push({
          hpPercentage,
          uhCoordinates: entry.uhCoordinates,
          isActive,
        });
      }
    }
    return partyData;
  }

  calculatePartyHp(partyListData, barRegion) {
    const barStartIndex = (barRegion.y - this.partyListRegion.y) * this.partyListRegion.width + (barRegion.x - this.partyListRegion.x);
    return calculatePartyHpPercentage(partyListData, resourceBars.partyEntryHpBar, barStartIndex * 3, 130);
  }

  checkPartyMemberStatus(partyListData, nameRegion) {
    const nameStartIndex = (nameRegion.y - this.partyListRegion.y) * this.partyListRegion.width + (nameRegion.x - this.partyListRegion.x);
    const nameEndIndex = nameStartIndex + nameRegion.width * nameRegion.height;
    const nameBuffer = partyListData.subarray(nameStartIndex * 3, nameEndIndex * 3);
    const status = findSequences(nameBuffer, PARTY_MEMBER_STATUS, null, 'first', true);

    return Object.keys(status.active || {}).length > 0 || Object.keys(status.activeHover || {}).length > 0;
  }

  handleHealthAndManaUpdates(capturedData) {
    const { newHealthPercentage, newManaPercentage } = this.calculateHealthAndMana(capturedData.hpMana);

    if (newHealthPercentage !== this.lastDispatchedHealthPercentage) {
      this.dispatchHealthUpdate(newHealthPercentage);
      this.lastDispatchedHealthPercentage = newHealthPercentage;
    }

    if (newManaPercentage !== this.lastDispatchedManaPercentage) {
      this.dispatchManaUpdate(newManaPercentage);
      this.lastDispatchedManaPercentage = newManaPercentage;
    }
  }

  dispatchHealthUpdate(percentage) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'setHealthPercent',
      payload: { hpPercentage: percentage },
    });
  }

  dispatchManaUpdate(percentage) {
    parentPort.postMessage({
      storeUpdate: true,
      type: 'setManaPercent',
      payload: { manaPercentage: percentage },
    });
  }

  calculateDelayTime(executionTime) {
    if (!this.initialized || !this.state?.global?.refreshRate) {
      return 16;
    }
    return Math.max(0, this.state.global.refreshRate - executionTime);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const worker = new ScreenMonitorWorker();
worker.start();
