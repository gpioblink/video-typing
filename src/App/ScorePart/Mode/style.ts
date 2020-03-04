import styled from '@emotion/styled'

export const Layout = styled.div`
  background-color: pink;
  padding: 5%;
  overflow: hidden;
  
 .mode {
   font-size: 3vw;
   animation: scroll 10s linear infinite;
   white-space: nowrap;
 }
 
 .window {
   display: inline-flex;
   overflow: hidden;
   height: 4vw;
   width: 100%;
 }
 
 @keyframes scroll{
    0% { transform: translateX(0%)}
    20% { transform: translateX(0%)}
  95% { transform: translateX(-100%)}
  100% { transform: translateX(-100%)}
 }
`;
