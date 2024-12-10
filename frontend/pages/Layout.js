import Actions from './Actions.js';
import Healing from './Healing.js';
import StyledDiv from './Layout.styled.js';
import { Route, Routes } from 'react-router-dom';
import React from 'react';
import SidebarWrapper from '../components/SidebarWrapper/SidebarWrapper.js';
import NavButton from '../components/NavButton/NavButton.js';
import image from '../assets/agony.png';
const Layout = () => (
  <StyledDiv>
    <h1 className="title">Automaton</h1>
    <div className="helper-wrapper">
      <div className="helper-wrapper2">
        <header>
          <NavButton to="/" text="User Rules" img={image}></NavButton>
          <NavButton to="/hotkeys" text="Hotkeys"></NavButton>
        </header>
        <div className="side-main">
          <SidebarWrapper className="aside">
            <NavButton to="/">User Rules</NavButton>
            <NavButton to="/hotkeys">Hotkeys</NavButton>
          </SidebarWrapper>
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Healing />} />
              <Route path="/hotkeys" element={<Actions />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  </StyledDiv>
);

export default Layout;
