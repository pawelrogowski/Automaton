import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';

export const StyledAside = styled.aside`
  border-top: 2px solid rgba(117, 117, 118, 0.8);
  border-left: 2px solid rgba(117, 117, 118, 0.8);
  border-bottom: 2px solid rgba(44, 44, 44, 0.8);
  border-right: 2px solid rgba(44, 44, 44, 0.8);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background-image: url(${tibiaBgDark});
  background-repeat: repeat;
  padding: 5px;
  height: 510px;
  width: 195px;
  margin-top: 5px;
  overflow-y: scroll;
`;
