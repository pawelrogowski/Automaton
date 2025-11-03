import React, { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  setCreatureMonitorConfigValue,
  setTargetingWorkerConfigValue,
  resetCreatureMonitorConfig,
  resetTargetingWorkerConfig,
} from '../redux/slices/workerConfigSlice.js';

const StyledSettings = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  color: #fafafa;
  font-size: 13px;

  .filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .filter-buttons {
    display: flex;
    gap: 8px;
  }

  .filter-button {
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fafafa;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    &.active {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.4);
    }
  }

  .reset-button {
    padding: 6px 12px;
    background: rgba(200, 0, 0, 0.3);
    border: 1px solid rgba(255, 0, 0, 0.3);
    color: #fafafa;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;

    &:hover {
      background: rgba(200, 0, 0, 0.5);
    }
  }

  .content-area {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .config-section {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 20px;
    margin-bottom: 20px;
  }

  .config-title {
    font-size: 16px;
    font-weight: bold;
    margin-bottom: 15px;
    color: #ffffff;
  }

  .config-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 15px;
  }

  .config-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .config-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .config-tooltip {
    cursor: help;
    color: rgba(255, 255, 255, 0.4);
  }

  .config-input {
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fafafa;
    font-size: 13px;
    border-radius: 3px;

    &:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.4);
    }

    &[type='number'] {
      width: 100%;
    }
  }

  .hotkeys-content {
    ol {
      padding-left: 20px;
      line-height: 1.8;
    }
  }
`;

const ConfigInput = ({ label, tooltip, value, onChange, min, max, step = 1, unit = '' }) => (
  <div className="config-item">
    <label className="config-label" title={tooltip}>
      {label} {unit && `(${unit})`}
      {tooltip && <span className="config-tooltip">ⓘ</span>}
    </label>
    <input
      type="number"
      className="config-input"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      min={min}
      max={max}
      step={step}
    />
  </div>
);

export const Settings = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const hash = location.hash || '#creatures';

  const creatureMonitorConfig = useSelector((state) => state.workerConfig.creatureMonitor);
  const targetingWorkerConfig = useSelector((state) => state.workerConfig.targetingWorker);

  const handleCreatureMonitorChange = useCallback(
    (key, value) => {
      dispatch(setCreatureMonitorConfigValue({ key, value }));
    },
    [dispatch]
  );

  const handleTargetingWorkerChange = useCallback(
    (key, value) => {
      dispatch(setTargetingWorkerConfigValue({ key, value }));
    },
    [dispatch]
  );

  const handleResetCreatureMonitor = useCallback(() => {
    if (window.confirm('Reset Creature Monitor settings to defaults?')) {
      dispatch(resetCreatureMonitorConfig());
    }
  }, [dispatch]);

  const handleResetTargetingWorker = useCallback(() => {
    if (window.confirm('Reset Targeting Worker settings to defaults?')) {
      dispatch(resetTargetingWorkerConfig());
    }
  }, [dispatch]);

  return (
    <StyledSettings>
      <div className="filter-bar">
        <div className="filter-buttons">
          <button
            className={`filter-button ${hash === '#creatures' ? 'active' : ''}`}
            onClick={() => navigate('/hotkeys#creatures')}
          >
            Creature Monitor
          </button>
          <button
            className={`filter-button ${hash === '#targeting' ? 'active' : ''}`}
            onClick={() => navigate('/hotkeys#targeting')}
          >
            Targeting Worker
          </button>
          <button
            className={`filter-button ${hash === '#hotkeys' ? 'active' : ''}`}
            onClick={() => navigate('/hotkeys#hotkeys')}
          >
            Global Hotkeys
          </button>
        </div>
      </div>

      <div className="content-area">
        {hash === '#creatures' && (
          <div className="config-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="config-title">Creature Monitor Configuration</div>
              <button className="reset-button" onClick={handleResetCreatureMonitor}>
                Reset to Defaults
              </button>
            </div>
            <div className="config-grid">
              <ConfigInput
                label="Player Animation Freeze"
                tooltip="Duration to freeze creature position updates after player movement to prevent jitter"
                value={creatureMonitorConfig.PLAYER_ANIMATION_FREEZE_MS}
                onChange={(v) => handleCreatureMonitorChange('PLAYER_ANIMATION_FREEZE_MS', v)}
                min={0}
                max={100}
                unit="ms"
              />
              <ConfigInput
                label="Sticky Snap Threshold"
                tooltip="Distance threshold for snapping creature to previous tile position (prevents micro-movements)"
                value={creatureMonitorConfig.STICKY_SNAP_THRESHOLD_TILES}
                onChange={(v) => handleCreatureMonitorChange('STICKY_SNAP_THRESHOLD_TILES', v)}
                min={0.1}
                max={2}
                step={0.1}
                unit="tiles"
              />
              <ConfigInput
                label="Jitter Confirmation Time"
                tooltip="Time to wait before confirming a creature position change (filters out OCR noise)"
                value={creatureMonitorConfig.JITTER_CONFIRMATION_TIME_MS}
                onChange={(v) => handleCreatureMonitorChange('JITTER_CONFIRMATION_TIME_MS', v)}
                min={0}
                max={500}
                unit="ms"
              />
              <ConfigInput
                label="Correlation Distance Threshold"
                tooltip="Maximum screen pixel distance to correlate a healthbar with a creature"
                value={creatureMonitorConfig.CORRELATION_DISTANCE_THRESHOLD_PIXELS}
                onChange={(v) => handleCreatureMonitorChange('CORRELATION_DISTANCE_THRESHOLD_PIXELS', v)}
                min={50}
                max={500}
                unit="px"
              />
              <ConfigInput
                label="Creature Grace Period"
                tooltip="Time to keep a creature in memory after it disappears (prevents flicker on lag)"
                value={creatureMonitorConfig.CREATURE_GRACE_PERIOD_MS}
                onChange={(v) => handleCreatureMonitorChange('CREATURE_GRACE_PERIOD_MS', v)}
                min={0}
                max={1000}
                unit="ms"
              />
              <ConfigInput
                label="Unmatched Blacklist Duration"
                tooltip="Duration to blacklist a tile after detecting an unmatched creature (prevents false positives)"
                value={creatureMonitorConfig.UNMATCHED_BLACKLIST_MS}
                onChange={(v) => handleCreatureMonitorChange('UNMATCHED_BLACKLIST_MS', v)}
                min={0}
                max={2000}
                unit="ms"
              />
              <ConfigInput
                label="Name Match Threshold"
                tooltip="Minimum similarity score (0-1) required to match OCR name with database name"
                value={creatureMonitorConfig.NAME_MATCH_THRESHOLD}
                onChange={(v) => handleCreatureMonitorChange('NAME_MATCH_THRESHOLD', v)}
                min={0.1}
                max={1}
                step={0.05}
                unit="0-1"
              />
            </div>
          </div>
        )}

        {hash === '#targeting' && (
          <div className="config-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="config-title">Targeting Worker Configuration</div>
              <button className="reset-button" onClick={handleResetTargetingWorker}>
                Reset to Defaults
              </button>
            </div>
            <div className="config-grid">
              <ConfigInput
                label="Main Loop Interval"
                tooltip="Targeting state machine update frequency (lower = more responsive, higher CPU)"
                value={targetingWorkerConfig.mainLoopIntervalMs}
                onChange={(v) => handleTargetingWorkerChange('mainLoopIntervalMs', v)}
                min={10}
                max={200}
                unit="ms"
              />
              <ConfigInput
                label="Unreachable Timeout"
                tooltip="Time to wait before abandoning an unreachable target"
                value={targetingWorkerConfig.unreachableTimeoutMs}
                onChange={(v) => handleTargetingWorkerChange('unreachableTimeoutMs', v)}
                min={50}
                max={1000}
                unit="ms"
              />
              <ConfigInput
                label="Click Throttle"
                tooltip="Minimum time between battle list clicks (prevents rapid toggling)"
                value={targetingWorkerConfig.clickThrottleMs}
                onChange={(v) => handleTargetingWorkerChange('clickThrottleMs', v)}
                min={50}
                max={1000}
                unit="ms"
              />
              <ConfigInput
                label="Verify Window"
                tooltip="Time to wait after clicking battle list before verifying target acquisition"
                value={targetingWorkerConfig.verifyWindowMs}
                onChange={(v) => handleTargetingWorkerChange('verifyWindowMs', v)}
                min={100}
                max={1000}
                unit="ms"
              />
              <ConfigInput
                label="Anti-Stuck Adjacent Timeout"
                tooltip="If adjacent to target with unchanged HP for this duration, reset targeting (prevents stuck state)"
                value={targetingWorkerConfig.antiStuckAdjacentMs}
                onChange={(v) => handleTargetingWorkerChange('antiStuckAdjacentMs', v)}
                min={1000}
                max={20000}
                unit="ms"
              />
            </div>
          </div>
        )}

        {hash === '#hotkeys' && (
          <div className="hotkeys-content">
            <ol>
              <li>Alt+W - Select active window and reset workers. Shows window ID in notification and starts updating hp and mana values</li>
              <li>Alt+E - Toggle bot enabled/disabled state. Plays sound and shows notification</li>
              <li>Alt+V - Toggle main window visibility (show/hide)</li>
              <li>Alt+1 - Switch to preset 1</li>
              <li>Alt+2 - Switch to preset 2</li>
              <li>Alt+3 - Switch to preset 3</li>
              <li>Alt+4 - Switch to preset 4</li>
              <li>Alt+5 - Switch to preset 5</li>
              <li>Alt+Escape - Toggle all main sections (Healing, Cavebot, Scripts, Targeting) on/off. Remembers previous states.</li>
              <li>Alt+C - Toggle Cavebot section enabled/disabled.</li>
              <li>Alt+H - Toggle Healing/Rules section enabled/disabled.</li>
              <li>Alt+S - Toggle Lua Scripts section enabled/disabled.</li>
              <li>Alt+T - Toggle Targeting section enabled/disabled.</li>
              <li>Alt+B - Toggle all main sections (Healing, Cavebot, Scripts, Targeting) on/off. If sections are in mixed states, first enables all, then disables all on next press.</li>
            </ol>
          </div>
        )}
      </div>
    </StyledSettings>
  );
};

export default Settings;
