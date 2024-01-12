import styled from 'styled-components';

const StyledNav = styled.nav`
  display: flex;
  align-items: center;
  width: 100%;
  ul {
    list-style: none;
    display: flex;
    height: 100%;
    gap: 24px;
    margin: 0;
    padding: 0;
    width: 100%;
    li {
    }
    a {
      text-decoration: none;
      color: #fafafa;
      transition: color 200ms;
      &:hover {
        color: #0066ff;
      }
    }
  }
  .character-name {
    color: #fafafa;
    font-size: 16px;
    margin-left: auto;
    padding-right: 24px;
  }
`;

export default StyledNav;
