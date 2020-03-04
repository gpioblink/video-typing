import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: gray;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  .item {
    padding: 4% 5% 2% 5%;
  }
  .title {
    font-size: 5vw;
  }
  .content {
    font-size: 4vw;
  }
`;
