// /home/orimorfus/Documents/Automaton/frontend/pages/LuaScripts.js
import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import StyledMain from './Healing.styled.js'; // Can reuse or create new styled component
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import PersistentScriptList from '../components/LuaScripts/PersistentScriptList.jsx';
import HotkeyScriptList from '../components/LuaScripts/HotkeyScriptList.jsx';
import { clearError } from '../redux/slices/luaSlice.js';

const LuaScripts = () => {
  const location = useLocation();
  const dispatch = useDispatch();
  const hash = location.hash;
  const error = useSelector((state) => state.lua.error);

  useEffect(() => {
    // Clear error on component unmount or when view changes
    return () => {
      dispatch(clearError());
    };
  }, [dispatch, hash]);

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
    content = (
      <p style={{ color: '#fafafa', textAlign: 'center' }}>
        Please select Persistent or Hotkey from the sidebar.
      </p>
    );
  }

  return (
    <StyledMain>
      {error && (
        <div style={{ color: 'red', textAlign: 'center' }}>{error}</div>
      )}
      {content}
    </StyledMain>
  );
};

export default LuaScripts;
