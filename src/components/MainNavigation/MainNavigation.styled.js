import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';
import tibiaBg from '../../assets/tibiaBg.webp';

const StyledNav = styled.nav`
  display: flex;
  align-items: center;
  width: 100%;
  border-top: 2px solid #757676;
  border-left: 2px solid #757676;
  border-bottom: 3px solid #2c2c2c;
  border-right: 3px solid #2c2c2c;
  background-image: url(${tibiaBgDark});
  background-repeat: repeat;
  padding: 4px 0 4px 24px;
  ul {
    list-style: none;
    display: flex;
    height: 100%;
    gap: 2px;
    margin: 0;
    padding: 0;
    width: 100%;
    align-items: center;
    li {
    }
    a {
      text-decoration: none;
      transition: color 200ms;
      color: rgb(175, 175, 175);
      border-top: 1px solid #757676;
      border-left: 1px solid #757676;
      border-bottom: 1px solid #2c2c2c;
      border-right: 1px solid #2c2c2c;
      padding: 2px 4px;
      background-image: url(${tibiaBg});
      &:active {
        border-top: 1px solid #2c2c2c;
        border-left: 1px solid #2c2c2c;
        border-bottom: 1px solid #757676;
        border-right: 1px solid #757676;
      }
    }
  }
  .character-name {
    color: #fafafa;
    font-size: 14px;
    margin-left: auto;
    padding-right: 24px;
  }
`;

export default StyledNav;
