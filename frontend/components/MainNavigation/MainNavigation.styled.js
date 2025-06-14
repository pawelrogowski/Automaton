import styled from 'styled-components';

const StyledNav = styled.nav`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  position: fixed;
  top: 0;
  justify-content: center;

  ul {
    list-style: none;
    display: flex;
    height: 100%;
    gap: 0px;
    margin: 0;
    padding: 0;
    align-items: center;
    li {
    }
    a {
      padding: 4px 15px 1px 4px;
      text-decoration: none;
      transition: color 200ms;
      background-repeat: repeat;
      text-shadow: -1px -1px 0px rgba(0, 0, 0, 1);
    }
  }
  .character-name {
    color: #909090;
    font-size: 11px;
    line-height: 20px;
  }
`;

export default StyledNav;
