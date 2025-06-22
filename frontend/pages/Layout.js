import ManaSync from './ManaSync.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import React, { useEffect, useRef, useState } from 'react';
import SidebarWrapper from '../components/SidebarWrapper/SidebarWrapper.js';
import NavButton from '../components/NavButton/NavButton.js';
import automaton from '../assets/cyberskull.png';
import settings from '../assets/settings.png';
import healParty from '../assets/actionBarItems/Ultimate_Healing_Rune.gif';
import hotkey from '../assets/hotkey.png';
import UMP from '../assets/actionBarItems/Ultimate_Mana_Potion.gif';
import SSA from '../assets/Stone_Skin_Amulet.gif';
import FAQ from '../assets/FAQ.png';
import ActionBarIcon from '../assets/action_bar.png';
import mageHat from '../assets/The_Epic_Wisdom.gif';
import CustomRules from '../assets/cutomRules.png';
import { setIsisBotEnabled, setRefreshRate } from '../redux/slices/globalSlice.js';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../components/Header/Header.jsx';
import { addRule } from '../redux/slices/ruleSlice.js';
import { addWaypoint, removeWaypoint } from '../redux/slices/cavebotSlice.js';
const { saveRules, loadRules } = window.electron;
import PresetSelector from '../components/PresetSelector/PresetSelector.jsx';
import SideBarNavButton from '../components/SideBarNavButton/SidebarNavButton.js';
import SidebarButton from '../components/SidebarButton.js/SidebarButton.js';
import { v4 as uuidv4 } from 'uuid';

import GameState from './GameState.js';
import Cavebot from './Cavebot.js'; // Import the new Cavebot component
import tibia from '../assets/tibia.svg';
import LuaScripts from './LuaScripts.js';
import luaIcon from '../assets/Anatomy_Book.gif'; // Correct path
import CustomSwitch from '../components/CustomSwitch/CustomSwitch.js';

// Helper to clamp value between min and max
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const DEBOUNCE_DELAY = 250; // milliseconds to wait after slider stops moving

const Layout = () => {
  const dispatch = useDispatch();
  const { windowId, isBotEnabled, refreshRate: refreshRateFromRedux, windowTitle } = useSelector((state) => state.global);
  const activePresetIndex = useSelector((state) => state.rules.activePresetIndex);
  const selectedWaypointId = useSelector((state) => state.cavebot.selectedWaypointId);
  const playerPosition = useSelector((state) => state.gameState.playerMinimapPosition);
  const location = useLocation();
  const hash = location.hash;
  const navigate = useNavigate();

  // Local state for immediate UI feedback
  const [displayedRate, setDisplayedRate] = useState(refreshRateFromRedux);
  // State for cavebot waypoint direction
  const [direction, setDirection] = useState('C');

  // Ref to store the debounce timeout ID
  const debounceTimeoutRef = useRef(null);

  // Redirect to default hash on Healing page load if no hash exists
  useEffect(() => {
    if (location.pathname === '/healing' && location.hash === '') {
      navigate('/healing#actionbar', { replace: true });
    }
    // Redirect to default hash on Lua Scripts page load if no hash exists
    if (location.pathname === '/luascripts' && location.hash === '') {
      navigate('/luascripts#persistent', { replace: true });
    }
  }, [location, navigate]);

  // Redirect root path to default healing page
  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/healing#actionbar', { replace: true });
    }
  }, [navigate, location]);

  // Update local state if Redux state changes externally
  useEffect(() => {
    setDisplayedRate(refreshRateFromRedux);
  }, [refreshRateFromRedux]);

  const handleAddRule = () => {
    // This function seems specific to the Healing/Rules page structure.
    // It might need adjustment or duplication for Lua scripts if adding rules
    // through a similar button structure on the Lua page.
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
        console.warn('Cannot add rule on current page/hash:', hash, 'Falling back to userRule.');
        ruleIdPrefix = 'userRule';
        break;
    }
    if (ruleIdPrefix) {
      const newRuleId = `${ruleIdPrefix}${uuidv4()}`;
      dispatch(addRule(newRuleId));
    }
  };

  const handleAddWaypoint = (waypointType) => {
    if (!playerPosition) {
      console.error('Player position not available.');
      return;
    }

    // Calculate new coordinates based on the selected direction
    let { x, y, z } = playerPosition;
    switch (direction) {
      case 'N':
        y -= 1;
        break;
      case 'S':
        y += 1;
        break;
      case 'W':
        x -= 1;
        break;
      case 'E':
        x += 1;
        break;
      case 'NW':
        x -= 1;
        y -= 1;
        break;
      case 'NE':
        x += 1;
        y -= 1;
        break;
      case 'SW':
        x -= 1;
        y += 1;
        break;
      case 'SE':
        x += 1;
        y += 1;
        break;
      // 'C' (Center) is the default, no change needed.
      default:
        break;
    }

    let defaultAction = '';
    if (waypointType === 'Action') {
      defaultAction = 'Enter your action';
    }

    const newWaypointPayload = {
      type: waypointType,
      x, // Use the adjusted x
      y, // Use the adjusted y
      z, // z remains the same
      range: 1,
      action: defaultAction,
    };

    dispatch(addWaypoint(newWaypointPayload));
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
      <Header>
        <NavButton
          to="/healing"
          text="Healing"
          // img={automaton}
          // imageWidth="22px"
        ></NavButton>
        <NavButton
          to="/cavebot"
          text="Cavebot"
          // img={automaton} // Placeholder icon
          // imageWidth="32px"
        ></NavButton>
        <NavButton
          to="/targeting"
          text="Targeting"
          // img={settings}
          // imageWidth="26px"
        ></NavButton>
        <NavButton
          to="/luascripts"
          text="Scripts"
          // img={luaIcon}
          //  imageWidth="32px"
        ></NavButton>

        {/* Add the button for Game State */}
        <NavButton
          to="/gameState"
          text="State"
          // img={tibia} // Use the imported icon
          // imageWidth="32px"
        ></NavButton>
        <NavButton
          to="/hotkeys"
          text="Settings"
          // img={settings}
          // imageWidth="26px"
        ></NavButton>
      </Header>
      <div className="side-main">
        <SidebarWrapper className="aside">
          {location.pathname.includes('/healing') && (
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
                  dispatch(setIsisBotEnabled(!isBotEnabled));
                }}
                tooltip="Enable/Disable global rule precessing (alt+e)"
              >
                <CustomSwitch
                  className="rule-input-enable-checkbox__custom-checkbox"
                  checked={isBotEnabled}
                  onChange={() => {
                    dispatch(setIsisBotEnabled(!isBotEnabled));
                  }}
                  disabled={windowId === null}
                />
                <span
                  onClick={() => {
                    dispatch(setIsisBotEnabled(!isBotEnabled));
                  }}
                >
                  Enable Bot
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
            </>
          )}

          {/* Sidebar links for Lua Scripts page */}
          {location.pathname.includes('/luascripts') && (
            <>
              <SideBarNavButton
                to="/luascripts#persistent"
                img={luaIcon} // Use the imported Lua icon
                text={'Persistent'}
                imageWidth="32px"
                tooltip="Manage persistent Lua scripts"
              ></SideBarNavButton>
              <SideBarNavButton
                to="/luascripts#hotkey"
                img={hotkey} // Reusing hotkey icon for hotkey scripts
                text={'Hotkey'}
                imageWidth="32px"
                tooltip="Manage hotkey Lua scripts"
              ></SideBarNavButton>
            </>
          )}

          {location.pathname === '/gameState' && (
            <>
              <SideBarNavButton
                to="/gameState#gameState"
                img={tibia} // Use the imported icon
                text={'Game State'}
                imageWidth="32px"
                tooltip="View the current game state slice"
              ></SideBarNavButton>
              <SideBarNavButton
                to="/gameState#globalState"
                img={tibia} // Use the imported icon
                text={'Global State'}
                imageWidth="32px"
                tooltip="View the current global state slice"
              ></SideBarNavButton>
              <SideBarNavButton
                to="/gameState#rules"
                img={tibia} // Use the imported icon
                text={'Rule State'}
                imageWidth="32px"
                tooltip="View the current healing/rule state slice"
              ></SideBarNavButton>
              <SideBarNavButton
                to="/gameState#luaState"
                img={tibia} // Use the imported icon
                text={'Lua State'}
                imageWidth="32px"
                tooltip="View the current Lua state slice"
              ></SideBarNavButton>
              <SideBarNavButton
                to="/gameState#cavebotState"
                img={tibia} // Use the imported icon
                text={'Cavebot State'}
                imageWidth="32px"
                tooltip="View the current cavebot state slice"
              ></SideBarNavButton>
            </>
          )}

          {location.pathname === '/cavebot' && (
            <>
              <div className="add-new-waypoint-section">
                <SidebarButton text={'Node'} onClick={() => handleAddWaypoint('Node')}></SidebarButton>
                <SidebarButton text={'Stand'} onClick={() => handleAddWaypoint('Stand')}></SidebarButton>
                <SidebarButton text={'Shovel'} onClick={() => handleAddWaypoint('Shovel')}></SidebarButton>
                <SidebarButton text={'Rope'} onClick={() => handleAddWaypoint('Rope')}></SidebarButton>
                <SidebarButton text={'Machete'} onClick={() => handleAddWaypoint('Machete')}></SidebarButton>
                <SidebarButton text={'Ladder'} onClick={() => handleAddWaypoint('Ladder')}></SidebarButton>
                <SidebarButton text={'Use'} onClick={() => handleAddWaypoint('Use')}></SidebarButton>
                <SidebarButton text={'Action'} onClick={() => handleAddWaypoint('Action')}></SidebarButton>
                <SidebarButton text={'Lure'} onClick={() => handleAddWaypoint('Lure')}></SidebarButton>
              </div>

              <div className="direction-radios">
                <label>
                  <input type="radio" name="direction" value="NW" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="N" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="NE" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="W" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="C" defaultChecked onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="E" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="SW" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="S" onChange={(e) => setDirection(e.target.value)} />
                </label>
                <label>
                  <input type="radio" name="direction" value="SE" onChange={(e) => setDirection(e.target.value)} />
                </label>
              </div>

              <SidebarButton
                text={'Delete Waypoint'}
                onClick={() => {
                  if (selectedWaypointId) {
                    dispatch(removeWaypoint(selectedWaypointId));
                  } else {
                    console.log('No waypoint selected to delete.');
                  }
                }}
              ></SidebarButton>
            </>
          )}
        </SidebarWrapper>
        <div className="main-content">
          <div className="routes-wrapper">
            <Routes>
              <Route path="/healing" element={<Healing />} />
              {/* Add the new route for Lua Scripts */}
              <Route path="/luascripts" element={<LuaScripts />} />
              {/* Add the new route for Game State */}
              {/* Modify the GameState route to handle hash for different slices */}
              <Route path="/gameState" element={<GameState />} />
              <Route path="/cavebot" element={<Cavebot />} />
              <Route
                path="/hotkeys"
                element={
                  <ol style={{ color: '#fafafa', fontSize: '13px' }}>
                    <li>
                      Alt+W - Select active window and reset workers. Shows window ID in notification and starts updating hp and mana values
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
            </Routes>
          </div>
        </div>
      </div>
    </StyledDiv>
  );
};

export default Layout;
