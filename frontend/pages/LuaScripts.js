// /home/orimorfus/Documents/Automaton/frontend/pages/LuaScripts.js
import React from 'react';
import { useLocation } from 'react-router-dom';
import StyledMain from './Healing.styled.js'; // Can reuse or create new styled component
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import PersistentScriptList from '../components/LuaScripts/PersistentScriptList.jsx'; // We will create this
import HotkeyScriptList from '../components/LuaScripts/HotkeyScriptList.jsx'; // We will create this

const LuaScripts = () => {
  const location = useLocation();
  const hash = location.hash;

  let content = null;
  let title = 'Lua Scripts';

  if (hash === '#persistent') {
    title = 'Persistent Scripts';
    content = <PersistentScriptList />;
  } else if (hash === '#hotkey') {
    title = 'Hotkey Scripts';
    content = <HotkeyScriptList />;
  } else {
      // Default view or redirect if no hash
       title = 'Select Script Type';
       content = <p style={{ color: '#fafafa', textAlign: 'center' }}>Please select Persistent or Hotkey from the sidebar.</p>;
  }


  return (
    <StyledMain>
      <HighWrapper title={title} className="lua-scripts-box">
        {content}
      </HighWrapper>
    </StyledMain>
  );
};

export default LuaScripts;