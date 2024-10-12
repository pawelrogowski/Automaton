import styled from 'styled-components';
import tibiaBg from '../assets/tibiaBg.webp';

const MainLayout = styled.div`
  width: 100vw;
  min-height: 100vh;
  flex-grow: 1;
  background-image: url(${tibiaBg});
  background-repeat: repeat;
`;

export default MainLayout;
