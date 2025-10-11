import React from 'react';
import { StyledLink } from './SidebarNavButton.styled.js';
import { useLocation } from 'react-router-dom';

const SideBarNavButton = ({
  to,
  img,
  text,
  imageWidth,
  className,
  tooltip,
}) => {
  const location = useLocation();

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
    <StyledLink
      className={className}
      to={to}
      $isActive={isActive}
      tooltip={tooltip}
    >
      <div className="image-wrapper">
        {img && <img src={img} alt={text} width={imageWidth} />}
      </div>
      <span>{text}</span>
    </StyledLink>
  );
};

export default SideBarNavButton;
