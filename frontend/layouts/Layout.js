import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from '../components/Header/Header.jsx';
import MainLayout from './Layout.styled.js';

const Layout = () => {
  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
};

export default Layout;
