import { createGlobalStyle } from 'styled-components';
import tibiaBgDark from './assets/tibiaBgDark.webp';

const GlobalStyles = createGlobalStyle`
  body {
    background-image: url(${tibiaBgDark});
    background-repeat: repeat;
    min-width: 911px;
  }
`;

export default GlobalStyles;
