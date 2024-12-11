import styled from 'styled-components';
import tibiaBG from '../../assets/tibiaBg.webp';
import tibiaBGDark from '../../assets/tibiaBgDark.webp';

export const StyledButton = styled.button`
  background-repeat: repeat;
  height: 32px;
  width: 100%;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${(props) => (props.active ? '#fafafa' : '#757676')};
  background: ${(props) => (props.active ? `url(${tibiaBGDark})` : `url(${tibiaBG})`)};
  border-top: 1px solid ${(props) => (props.active ? '#2c2c2c' : '#757676')};
  border-left: 1px solid ${(props) => (props.active ? '#2c2c2c' : '#757676')};
  border-bottom: 1px solid ${(props) => (props.active ? '#757676' : '#2c2c2c')};
  border-right: 1px solid ${(props) => (props.active ? '#757676' : '#2c2c2c')};
  font-size: 10px;

  &:hover {
    cursor: pointer;
  }
`;
