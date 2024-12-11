import Misc from './Misc.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes, useLocation } from 'react-router-dom';
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

const Layout = () => {
  const dispatch = useDispatch();
  const activePresetIndex = useSelector((state) => state.healing.activePresetIndex);
  const rules = useSelector((state) => state.healing.presets[activePresetIndex]);
  const { windowId, botEnabled } = useSelector((state) => state.global);

  const location = useLocation(); // Access current route
  useEffect(() => {
    console.log(location);
  }, [location]);

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
      <h1 className="title">Automaton</h1>
      <div className="helper-wrapper">
        <div className="helper-wrapper2">
          <Header>
            <NavButton to="/" text="Automaton" img={automaton} imageWidth="22px"></NavButton>
            <NavButton to="/hotkeys" text="Hotkeys" img={hotkey} imageWidth="32px"></NavButton>
            <NavButton to="/about" text="About" img={anatomyBook} imageWidth="32px"></NavButton>
          </Header>
          <div className="side-main">
            <SidebarWrapper className="aside">
              {location.pathname === '/' || location.pathname === '/healing' ? (
                <>
                  <div className="button-container">
                    <button className="add-button" type="button" onMouseDown={handleAddHealingRule}>
                      Add New Rule
                    </button>
                    <div className="save-load-buttons">
                      <button className="save-button" type="button" onMouseDown={handleLoadRules}>
                        LOAD
                      </button>
                      <button className="load-button" type="button" onMouseDown={handleSaveRules}>
                        SAVE
                      </button>
                    </div>
                  </div>
                  <PresetSelector />
                  <div className="checkbox-wrapper" onClick={handleBotEnabledToggle}>
                    <CustomCheckbox
                      checked={botEnabled}
                      onChange={handleBotEnabledToggle}
                      disabled={windowId === null}
                      width={18}
                      height={18}
                    />
                    <span>Enable (alt+e)</span>
                  </div>
                </>
              ) : null}
              <SidebarButton img={automaton} text="Potions"></SidebarButton>
              <SidebarButton img={automaton} text="Potions"></SidebarButton>
              <SidebarButton img={automaton} text="Potions"></SidebarButton>
            </SidebarWrapper>
            <main className="main-content">
              <Routes>
                <Route path="/" element={<Healing />} />
                <Route path="/healing" element={<Healing />} />
                <Route path="/misc" element={<Misc />} />
              </Routes>
            </main>
          </div>
        </div>
      </div>
    </StyledDiv>
  );
};

export default Layout;
