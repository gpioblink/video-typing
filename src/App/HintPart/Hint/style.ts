import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: #324851;
  color: #DDDDDD;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  height: 40vw;
  
  .item {
    padding: 4% 5% 2% 5%;
  }
  .title {
    font-size: 2vw;
  }
  .content {
    font-size: 1vw;
    padding: 3% 0 3% 3%;
  }
`;
