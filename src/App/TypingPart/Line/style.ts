import styled from '@emotion/styled'

export const Style = styled.div`
height: 6vw;
display: grid;
grid-template-columns: repeat(50, 1.5vw);
grid-template-rows: [text-start] 60% [line-start] 10% [tag-start] auto;
font-family: monospace;
font-size: 3vw;
`;
