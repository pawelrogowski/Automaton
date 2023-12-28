import styled from 'styled-components';

const StyledNav = styled.nav`
  display: flex;
  align-items: center;
  ul {
    list-style: none;
    display: flex;
    height: 100%;
    gap: 24px;
    margin: 0;
    padding: 0;

    li {
    }
    a {
      text-decoration: none;
      color: #c5c5c5;
      transition: color 200ms;
      &:hover {
        color: #0066ff;
      }
    }
  }
`;

export default StyledNav;
