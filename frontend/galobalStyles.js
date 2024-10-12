import { createGlobalStyle } from 'styled-components';
import tibiaBg from './assets/tibiaBg.webp';

const GlobalStyles = createGlobalStyle`
  body {
    background-image: url(${tibiaBg});
    background-repeat: repeat;

  }
`;

export default GlobalStyles;
