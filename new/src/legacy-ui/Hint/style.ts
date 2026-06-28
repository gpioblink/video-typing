import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: #324851;
  color: #dddddd;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100%;

  .item {
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .item.selectable {
    cursor: pointer;
  }

  .item.selectable:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 700;
  }

  .hintNumber {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: #d8efe5;
    color: #17201d;
    font-size: 12px;
  }

  .content {
    font-size: 12px;
    line-height: 1.5;
    padding-top: 8px;
    white-space: pre-wrap;
  }
`;
