import styled from 'styled-components';

const MainLayout = styled.div`
  border: 2px solid #717171;
  padding: 2px;
  width: 100vw;
  min-height: 100vh;
  padding-top: 20px;
  flex-grow: 1;
  > div {
    padding: 1px;
    border: 1px solid #717171;
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-height: calc(100dvh - 26px);
    > div {
      padding: 3px;
      display: flex;
      flex-direction: column;
      flex-grow: 1;
    }
  }
`;

export default MainLayout;
