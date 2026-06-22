import styled from '@emotion/styled';

export const Layout = styled.div<{ clickable: boolean }>`
  color: #eeeeee;
  cursor: ${(props) => (props.clickable ? 'pointer' : 'default')};

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
