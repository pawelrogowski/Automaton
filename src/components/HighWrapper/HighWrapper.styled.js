import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

export const StyledDiv = styled.div`
  border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 2px solid #2c2c2c;
  border-right: 2px solid #2c2c2c;
  display: flex;
  flex-direction: column;
  .title {
    width: 100%;
    height: 18px;
    font-size: 12px;
    color: #fafafa;
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