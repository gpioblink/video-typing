import styled from '@emotion/styled';

export const Style = styled.div<{ columnCount: number }>`
  height: 48px;
  display: grid;
  grid-template-columns: repeat(${(props) => props.columnCount}, 12px);
  grid-template-rows: [text-start] 60% [line-start] 10% [tag-start] auto;
  font-family: monospace;
  font-size: 24px;
`;
