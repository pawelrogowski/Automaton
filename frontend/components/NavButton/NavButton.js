import React from 'react';
import { StyledLink } from './NavButton.styled.js';
import { useLocation, useNavigate } from 'react-router-dom';

const NavButton = ({
  to,
  img,
  text,
  imageWidth,
  className,
  tooltip,
  children,
}) => {
  const location = useLocation();
  const navigate = useNavigate();

  // Split 'to' into path and optional hash
  const [targetPath, targetHash] = to.split('#');
  const currentPath = location.pathname;
  const currentHash = location.hash.slice(1); // Remove '#' for comparison

  // Determine active state
  const isBaseLink = !targetHash; // True if the link has no hash
  const isExactPathActive =
    currentPath === targetPath && !currentHash && isBaseLink;
  const isExactHashActive =
    currentPath === targetPath && currentHash === targetHash;
  const isBasePathActiveWithHash =
    currentPath === targetPath && currentHash && isBaseLink;

  const isActive =
    isExactPathActive || isExactHashActive || isBasePathActiveWithHash;

  return (
    <StyledLink className={className} $isActive={isActive} tooltip={tooltip}>
      {img && <img src={img} alt={text} width={imageWidth} />}
      <span onClick={() => navigate(to)}>{text}</span>
      {children}
    </StyledLink>
  );
};

export default NavButton;
