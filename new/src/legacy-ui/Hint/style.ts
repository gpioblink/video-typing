import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: #324851;
  color: #dddddd;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  width: 320px;
  max-height: 360px;

  .item {
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .title {
    font-size: 18px;
    font-weight: 700;
  }

  .content {
    font-size: 12px;
    line-height: 1.5;
    padding-top: 8px;
  }
`;
