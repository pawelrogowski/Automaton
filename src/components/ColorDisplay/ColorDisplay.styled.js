import styled from 'styled-components';

const StyledDiv = styled.div`
  width: 100px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid #fafafa;

  display: flex;
  justify-content: center;
  align-items: center;
  > span {
    font-size: 16px;
    color: white;
    mix-blend-mode: difference;
  }
`;

export default StyledDiv;
