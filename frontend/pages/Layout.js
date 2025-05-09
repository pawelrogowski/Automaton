import ManaSync from './ManaSync.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import React, { useEffect, useRef, useState } from 'react';
import SidebarWrapper from '../components/SidebarWrapper/SidebarWrapper.js';
import NavButton from '../components/NavButton/NavButton.js';
import automaton from '../assets/cyberskull.png';
import healParty from '../assets/actionBarItems/Ultimate_Healing_Rune.gif';
import healingImg from '../assets/Light_Healing.gif';
import hotkey from '../assets/hotkey.png';
import UMP from '../assets/actionBarItems/Ultimate_Mana_Potion.gif';
import momentum from '../assets/Momentum_Effect.gif';
import SSA from '../assets/Stone_Skin_Amulet.gif';
import FAQ from '../assets/FAQ.png';
import ActionBarIcon from '../assets/action_bar.png';
import mageHat from '../assets/The_Epic_Wisdom.gif';
import CustomRules from '../assets/cutomRules.png';
import { setIsBotEnabled, setRefreshRate } from '../redux/slices/globalSlice.js';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../components/Header/Header.jsx';
import { addRule, addHealFriendRule, addManaSyncRule } from '../redux/slices/healingSlice.js';
const { saveRules, loadRules } = window.electron;
import PresetSelector from '../components/PresetSelector/PresetSelector.jsx';
import CustomCheckbox from '../components/CustomCheckbox/CustomCheckbox.js';
import HoverInfo from '../components/HoverInfo/HoverInfo.jsx';
import SideBarNavButton from '../components/SideBarNavButton/SidebarNavButton.js';

import { v4 as uuidv4 } from 'uuid';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog.jsx';
import EquipWrapper from './Equip.js';
import GearIcon from '../assets/Stone_Skin_Amulet.gif';

// Helper to clamp value between min and max
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const DEBOUNCE_DELAY = 250; // milliseconds to wait after slider stops moving

const Layout = () => {
  const dispatch = useDispatch();
  const { windowId, botEnabled, refreshRate: refreshRateFromRedux, windowTitle, actualFps } = useSelector((state) => state.global);
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);

  const location = useLocation();
  const hash = location.hash;
  const navigate = useNavigate();

  // Local state for immediate UI feedback
  const [displayedRate, setDisplayedRate] = useState(refreshRateFromRedux);

  // Ref to store the debounce timeout ID
  const debounceTimeoutRef = useRef(null);

  useEffect(() => {
    console.log(location);
    if (location.pathname === '/healing' && location.hash === '') {
      navigate('/healing#actionbar', { replace: true });
      // Blur the focused element after navigation
      document.activeElement?.blur();
    }
  }, [location, navigate]);

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/healing#actionbar', { replace: true });
      // Blur the focused element after navigation
      document.activeElement?.blur();
    }
  }, [navigate, location]);

  // Update local state if Redux state changes externally
  useEffect(() => {
    setDisplayedRate(refreshRateFromRedux);
  }, [refreshRateFromRedux]);

  const handleAddRule = () => {
    let ruleIdPrefix;
    switch (hash) {
      case '#userrules':
        ruleIdPrefix = 'userRule';
        break;
      case '#party':
        ruleIdPrefix = 'healFriend';
        break;
      case '#manasync':
        ruleIdPrefix = 'manaSync';
        break;
      case '#actionbar':
        ruleIdPrefix = 'actionBarItem';
        break;
      case '#rotations':
        ruleIdPrefix = 'rotationRule';
        break;
      case '#equip':
        ruleIdPrefix = 'equipRule';
        break;
      default:
        console.warn("Cannot add rule on current page/hash:", hash, "Falling back to userRule.");
        ruleIdPrefix = 'userRule';
        break;
    }
     if (ruleIdPrefix) {
        const newRuleId = `${ruleIdPrefix}${uuidv4()}`;
        dispatch(addRule(newRuleId));
    }
  };

  // Debounced handler for slider change
  const handleRefreshRateChange = (event) => {
    const newRate = parseInt(event.target.value, 10);

    // --- Immediate UI Update ---
    setDisplayedRate(newRate); // Update local state immediately

    // --- Debounced Redux Update ---
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      console.log(`Debounced: Dispatching setRefreshRate(${newRate})`);
      dispatch(setRefreshRate(newRate));
    }, DEBOUNCE_DELAY);
  };

  // Clean up the timeout when the component unmounts
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <StyledDiv>
      <h1 className="title">
        {windowTitle}
      </h1>

      <div className="helper-wrapper">
        <div className="helper-wrapper2">
          <Header>
            <NavButton
              to="/healing"
              text="Automaton"
              img={automaton}
              imageWidth="22px"
              tooltip="Automation Section - Add/Remove custom rules."
            ></NavButton>
            <NavButton
              to="/hotkeys"
              text="Hotkeys"
              img={hotkey}
              imageWidth="32px"
              tooltip="Hotkeys Section - Overview of key combination to controll the bot."
            ></NavButton>
            {/* <NavButton to="/faq" text="FAQ" img={FAQ} imageWidth="32px" tooltip="Frequently Asked Questions"></NavButton>
            <NavButton to="/about" text="About" img={anatomyBook} imageWidth="32px" tooltip="About Tibia Automaton Page."></NavButton> */}
          </Header>
          <div className="side-main">
            <SidebarWrapper className="aside">
              {location.pathname === '/' || location.pathname.includes('/healing') ? (
                <>
                  <div className="button-container">
                    <button className="add-button" type="button" onMouseDown={handleAddRule} tooltip="Add a new rule to selected section">
                      Add New Rule
                    </button>
                    <div className="save-load-buttons">
                      <button
                        className="save-button"
                        type="button"
                        onMouseDown={async () => {
                          await loadRules();
                        }}
                        tooltip="Load rules from a file - this replaces existing rules"
                      >
                        Load
                      </button>
                      <button
                        className="load-button"
                        type="button"
                        onMouseDown={() => {
                          saveRules();
                        }}
                        tooltip="Save rules to a file"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <PresetSelector />
                  <div
                    className="checkbox-wrapper"
                    onClick={() => {
                      dispatch(setIsBotEnabled(!botEnabled));
                    }}
                    tooltip="Enable/Disable global rule precessing (alt+e)"
                  >
                    <CustomCheckbox
                      checked={botEnabled}
                      onChange={() => {
                        dispatch(setIsBotEnabled(!botEnabled));
                      }}
                      disabled={windowId === null}
                      width={18}
                      height={18}
                    />
                    <span
                      onClick={() => {
                        dispatch(setIsBotEnabled(!botEnabled));
                      }}
                    >
                      Enable (alt+e)
                    </span>
                  </div>
                  <SideBarNavButton
                    to="/healing#actionbar"
                    img={ActionBarIcon}
                    text={'Action Bar'}
                    imageWidth="32px"
                    tooltip="Show action bar rules"
                  ></SideBarNavButton>
                  <SideBarNavButton
                    to="/healing#party"
                    img={healParty}
                    imageWidth="32px"
                    text={'Party Heal'}
                    tooltip="Show party heal rules"
                  ></SideBarNavButton>
                  <SideBarNavButton
                    to="/healing#manasync"
                    img={UMP}
                    imageWidth="32px"
                    text={'Potion-Sync'}
                    tooltip="Show potion-sync rules - triggers only after detecting attack cooldown"
                    className="UMP-image"
                  ></SideBarNavButton>
                  <SideBarNavButton
                    to="/healing#equip"
                    img={SSA}
                    imageWidth="32px"
                    text={'Auto Equip'}
                    tooltip="Show auto equip rules"
                    className="SSA-image"
                  ></SideBarNavButton>
                  <SideBarNavButton
                    to="/healing#userrules"
                    img={CustomRules}
                    text={'Custom Rules'}
                    imageWidth="32px"
                    tooltip="Show custom rules"
                  ></SideBarNavButton>
                  <SideBarNavButton
                    to="/healing#rotations"
                    img={mageHat}
                    text={'Spell Rotations'}
                    imageWidth="32px"
                    tooltip="Show spell rotation rules"
                  ></SideBarNavButton>

                  {/* --- Refresh Rate Slider --- */}
                  <div className="slider-container" tooltip={`Adjust screen capture rate: ${displayedRate} FPS`}>
                    <label htmlFor="refreshRateSlider">Target Refresh Rate ({displayedRate} FPS)</label>
                    <input
                      type="range"
                      id="refreshRateSlider"
                      min="10"
                      max="60"
                      step="1"
                      value={displayedRate}
                      onChange={handleRefreshRateChange}
                      disabled={windowId === null}
                    />
                    {/* Display Actual FPS */}
                    {windowId !== null && (
                      <span style={{ fontSize: '11px', color: '#aaa', display: 'block', textAlign: 'center', marginTop: '2px' }}>
                        Actual: {actualFps} FPS
                      </span>
                    )}
                  </div>
                  {/* --- End Refresh Rate Slider --- */}
                </>
              ) : null}
            </SidebarWrapper>
            <div className="main-content">
              <div className="routes-wrapper">
                <Routes>
                  <Route path="/healing" element={<Healing />} />
                  <Route
                    path="/hotkeys"
                    element={
                      <ol style={{ color: '#fafafa', fontSize: '13px' }}>
                        <li>
                          Alt+W - Select active window and reset workers. Shows window ID in notification and starts updating hp and mana
                          values
                        </li>
                        <li>Alt+E - Toggle bot enabled/disabled state. Plays sound and shows notification</li>
                        <li>Alt+V - Toggle main window visibility (show/hide)</li>
                        <li>Alt+1 - Switch to preset 1</li>
                        <li>Alt+2 - Switch to preset 2</li>
                        <li>Alt+3 - Switch to preset 3</li>
                        <li>Alt+4 - Switch to preset 4</li>
                        <li>Alt+5 - Switch to preset 5</li>
                      </ol>
                    }
                  />
                  <Route path="/about" element={<span style={{ color: '#fafafa', fontSize: '24px' }}>Coming Soon</span>} />
                  <Route
                    path="/faq"
                    element={
                      <ol style={{ color: '#fafafa', fontSize: '13px' }}>
                        <li>Coming Soon</li>
                      </ol>
                    }
                  />
                </Routes>
              </div>
            </div>
          </div>
          <HoverInfo></HoverInfo>
        </div>
      </div>
    </StyledDiv>
  );
};

export default Layout;
