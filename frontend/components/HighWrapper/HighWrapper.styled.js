import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

export const StyledDiv = styled.div`
  position: relative;
  border-top: 2px solid rgba(117, 117, 118, 0.8);
  border-left: 2px solid rgba(117, 117, 118, 0.8);
  border-bottom: 2px solid rgba(44, 44, 44, 0.8);
  border-right: 2px solid rgba(44, 44, 44, 0.8);
  display: flex;
  flex-direction: column;

  .blackbox {
    border-left: solid black 1px;
    border-top: solid black 1px;
    border-bottom: solid black #747474;
    border-right: solid black #747474;
  }
  .title {
    width: 100%;
    height: 18px;
    font-size: 12px;
    color: #909090;
    display: flex;
    justify-content: center;
    align-items: center;
    background-image: url(${tibiaBgDark});
    background-repeat: repeat;
    border-bottom: 1px solid black;
  }
  .wrapped-content {
    padding: 4px;
    display: flex;
  }
`;
