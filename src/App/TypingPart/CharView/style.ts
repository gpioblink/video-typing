import styled from '@emotion/styled'

export const Layout = styled.div`
grid-column: auto;
grid-row-start: text-start;

.available {
    animation: blinker 1s step-start infinite;
}

@keyframes blinker {
    50% {
        opacity: 0;
    }
}

.mistaken {
    color: red;
}
`;
