import Misc from './Misc.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import React, { useEffect } from 'react';
import SidebarWrapper from '../components/SidebarWrapper/SidebarWrapper.js';
import NavButton from '../components/NavButton/NavButton.js';
import automaton from '../assets/cyberskull.png';
import hotkey from '../assets/hotkey.png';
import anatomyBook from '../assets/Anatomy_Book.gif';
import { setIsBotEnabled } from '../redux/slices/globalSlice.js';
import { useSelector, useDispatch } from 'react-redux';
import Header from '../components/Header/Header.jsx';
import SidebarButton from '../components/SidebarButton.js/SidebarButton.js';
import { addRule } from '../redux/slices/healingSlice.js';
const { saveRules, loadRules } = window.electron;
import PresetSelector from '../components/PresetSelector/PresetSelector.jsx';
import CustomCheckbox from '../components/CustomCheckbox/CustomCheckbox.js';
import HoverInfo from '../components/HoverInfo/HoverInfo.jsx';

const Layout = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { windowId, botEnabled } = useSelector((state) => state.global);

  const location = useLocation();
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

  const handleAddHealingRule = () => {
    dispatch(addRule());
  };

  const handleBotEnabledToggle = () => {
    dispatch(setIsBotEnabled(!botEnabled));
  };

  const handleSaveRules = () => {
    saveRules();
  };

  const handleLoadRules = async () => {
    await loadRules();
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
            <NavButton
              to="/about"
              text="About"
              img={anatomyBook}
              imageWidth="32px"
              tooltip="About Tibia Automaton Page."
            ></NavButton>
          </Header>
          <div className="side-main">
            <SidebarWrapper className="aside">
              {location.pathname === '/' || location.pathname.includes('/healing') ? (
                <>
                  <div className="button-container">
                    <button
                      className="add-button"
                      type="button"
                      onMouseDown={handleAddHealingRule}
                      tooltip="Add a new rule to selected section"
                    >
                      Add New Rule
                    </button>
                    <div className="save-load-buttons">
                      <button
                        className="save-button"
                        type="button"
                        onMouseDown={handleLoadRules}
                        tooltip="Load rules from a file - this replaces existing rules"
                      >
                        LOAD
                      </button>
                      <button
                        className="load-button"
                        type="button"
                        onMouseDown={handleSaveRules}
                        tooltip="Save rules to a file"
                      >
                        SAVE
                      </button>
                    </div>
                  </div>
                  <PresetSelector />
                  <div
                    className="checkbox-wrapper"
                    onClick={handleBotEnabledToggle}
                    tooltip="Enable/Disable global rule precessing (alt+e)"
                  >
                    <CustomCheckbox
                      checked={botEnabled}
                      onChange={handleBotEnabledToggle}
                      disabled={windowId === null}
                      width={18}
                      height={18}
                    />
                    <span>Enable (alt+e)</span>
                  </div>
                  <NavButton
                    to="/healing#userrules"
                    image={automaton}
                    text={'UserRules'}
                    tooltip="Show user rules"
                  ></NavButton>
                  <NavButton
                    to="/healing#misc"
                    image={automaton}
                    text={'Misc'}
                    tooltip="Show miscelanious settings"
                  ></NavButton>
                </>
              ) : null}
            </SidebarWrapper>
            <div className="main-content">
              <Routes>
                <Route path="/" element={<Healing />} />
                <Route path="/healing" element={<Healing />} />
                <Route path="/misc" element={<Misc />} />
              </Routes>
              <HoverInfo></HoverInfo>
            </div>
          </div>
        </div>
      </div>
    </StyledDiv>
  );
};

export default Layout;
