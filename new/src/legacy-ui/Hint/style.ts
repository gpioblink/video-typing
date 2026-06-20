import styled from '@emotion/styled';

export const Layout = styled.div`
  background-color: #324851;
  color: #dddddd;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  width: 320px;
  max-height: 360px;

  .status {
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.12);
  }

  .statusRow + .statusRow {
    margin-top: 8px;
  }

  .statusLabel {
    display: block;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9dbeb7;
  }

  .statusValue {
    display: block;
    margin-top: 2px;
    font-size: 16px;
    font-weight: 700;
    word-break: break-word;
  }

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
