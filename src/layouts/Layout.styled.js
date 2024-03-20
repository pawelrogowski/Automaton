import styled from 'styled-components';

const MainLayout = styled.div`
  border: 2px solid #717171;
  padding: 2px;
  width: 100vw;
  min-height: 100vh;
  padding-top: 20px;
  > div {
    padding: 1px;
    border: 1px solid #717171;
    height: 100%;
    > div {
      padding: 3px;
      border: 1px solid #262727;
      height: 100%;
    }
  }
`;

export default MainLayout;
