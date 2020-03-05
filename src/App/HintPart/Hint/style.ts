import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: gray;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  height: 45vw;
  
  .item {
    padding: 4% 5% 2% 5%;
  }
  .title {
    font-size: 2vw;
  }
  .content {
    font-size: 1vw;
  }
`;
