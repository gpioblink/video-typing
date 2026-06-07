import styled from '@emotion/styled';

export const Layout = styled.div`
  color: #eeeeee;

  .available {
    animation: blinker 1s step-start infinite;
  }

  @keyframes blinker {
    50% {
      opacity: 0;
    }
  }

  .mistaken {
    color: #ff6b6b;
  }
`;
