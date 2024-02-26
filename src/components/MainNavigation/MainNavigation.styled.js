import styled from 'styled-components';
import tibiaBgDark from '../../assets/tibiaBgDark.webp';
import tibiaBg from '../../assets/tibiaBg.webp';

const StyledNav = styled.nav`
  display: flex;
  align-items: center;
  width: 100%;
  position: fixed;
  top: 0;
  justify-content: center;
  background-image: url(${tibiaBg});
  padding-left: 18px;
  border-left: 2px solid #717171;
  border-right: 2px solid #717171;
  border-top: 2px solid #717171;
  ul {
    list-style: none;
    display: flex;
    height: 100%;
    gap: 0px;
    margin: 0;
    padding: 0;
    width: 100%;
    align-items: center;
    li {
    }
    a {
      padding: 4px 15px 1px 4px;
      text-decoration: none;
      transition: color 200ms;
      color: rgb(175, 175, 175);
      border-top: 2px solid #757575;
      border-left: 2px solid #757575;
      border-bottom: 2px solid #757575;
      border-right: 2px solid #757575;
      background-image: url(${tibiaBgDark});
      background-repeat: repeat;
      text-shadow: -1px -1px 0px rgba(0, 0, 0, 1);
      &:active {
        border-top: 2px solid #757575;
        border-left: 2px solid #757575;
        border-bottom: none;
        border-right: 2px solid #757575;
      }
    }
  }
  .character-name {
    color: #fafafa;
    font-size: 12px;

    /* margin-left: auto;
    padding-right: 24px; */
  }
`;

export default StyledNav;
