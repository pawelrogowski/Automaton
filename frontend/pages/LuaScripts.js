import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import styled from 'styled-components';
import PersistentScriptList from '../components/LuaScripts/PersistentScriptList.jsx';
import { clearError } from '../redux/slices/luaSlice.js';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const ErrorBanner = styled.div`
  padding: 12px 24px;
  background-color: rgba(204, 51, 51, 0.15);
  border-left: 4px solid #cc3333;
  color: #ff6b6b;
  font-size: 14px;
  font-family: sans-serif;
  margin: 16px 24px;
  border-radius: 4px;
`;

const ContentArea = styled.div`
  flex: 1;
  overflow: auto;
  padding: 0;
`;

const LuaScripts = () => {
  const dispatch = useDispatch();
  const error = useSelector((state) => state.lua.error);

  useEffect(() => {
    // Clear error on component unmount
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);

  return (
    <PageContainer>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ContentArea>
        <PersistentScriptList />
      </ContentArea>
    </PageContainer>
  );
};

export default LuaScripts;
