import styled from 'styled-components';

export const StyledLink = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  text-decoration: none;
  color: inherit;
  gap: 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);

  ${({ $isActive }) =>
    $isActive &&
    `
      background: rgba( 255, 255, 255, 0.15 );
      border-radius: 4px;
      border: 1px solid rgba( 255, 255, 255, 0.18 );
  `}

  img {
    margin-right: 8px;
  }

  > span {
    text-align: center;
    color: #fafafa;
    padding: 0 18px;
  }
`;
