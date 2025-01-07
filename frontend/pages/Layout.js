import ManaSync from './ManaSync.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import React, { useEffect } from 'react';
import SidebarWrapper from '../components/SidebarWrapper/SidebarWrapper.js';
import NavButton from '../components/NavButton/NavButton.js';
import automaton from '../assets/cyberskull.png';
import healParty from '../assets/Heal_Party.gif';
import healingImg from '../assets/Light_Healing.gif';
import hotkey from '../assets/hotkey.png';
import anatomyBook from '../assets/Anatomy_Book.gif';
import UMP from '../assets/Ultimate_Mana_Potion.gif';
import SSA from '../assets/Stone_Skin_Amulet.gif';
import { setIsBotEnabled } from '../redux/slices/globalSlice.js';
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
const Layout = () => {
  const dispatch = useDispatch();
  const { windowId, botEnabled } = useSelector((state) => state.global);

  const location = useLocation();
  const hash = location.hash;
  const navigate = useNavigate();

  useEffect(() => {
    console.log(location);
    if (location.pathname === '/healing' && location.hash == '') {
      navigate('/healing#userrules', { replace: true });
    }
  }, [location]);

  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/healing#userrules', { replace: true });
    }
  }, [navigate, location]);

  const handleAddRule = () => {
    const newRuleId = uuidv4();
    hash === '#userrules'
      ? dispatch(addRule(`userRule${newRuleId}`))
      : hash === '#party'
        ? dispatch(addRule(`healFriend${newRuleId}`))
        : hash === '#manasync'
          ? dispatch(addRule(`manaSync${newRuleId}`))
          : null;
  };
  return (
    <StyledDiv>
      <h1 className="title" tooltip="just a title bar">
        Automaton
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
            <NavButton to="/about" text="About" img={anatomyBook} imageWidth="32px" tooltip="About Tibia Automaton Page."></NavButton>
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
                        LOAD
                      </button>
                      <button
                        className="load-button"
                        type="button"
                        onMouseDown={() => {
                          saveRules();
                        }}
                        tooltip="Save rules to a file"
                      >
                        SAVE
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
                    <span>Enable (alt+e)</span>
                  </div>
                  <SideBarNavButton
                    to="/healing#userrules"
                    img={healingImg}
                    text={'Auto Heal'}
                    imageWidth="32px"
                    tooltip="Show user rules"
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
                    text={'Mana-Sync'}
                    tooltip="Show mana sync rules"
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
                </>
              ) : null}
            </SidebarWrapper>
            <div className="main-content">
              <div className="routes-wrapper">
                <Routes>
                  <Route path="/healing" element={<Healing />} />
                  {/* <Route path="/healing#party" element={<ManaSync />} />
                  <Route path="/healing#manasync" element={<ManaSync />} /> */}
                  <Route path="/hotkeys" element={<span style={{ color: '#fafafa', fontSize: '24px' }}>Coming Soon</span>} />
                  <Route path="/about" element={<span style={{ color: '#fafafa', fontSize: '24px' }}>Coming Soon</span>} />
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
