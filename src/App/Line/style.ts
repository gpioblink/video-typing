import styled from '@emotion/styled'

export const Style = styled.div`
background-color: #F0F0F0;
height: 100px;
display: grid;
grid-template-columns: repeat(50, 20px);
grid-template-rows: [text-start] 40% [line-start] 10% [tag-start] auto;
font-family: monospace;
font-size: 36px;
`;
