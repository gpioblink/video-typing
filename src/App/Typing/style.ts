import styled from '@emotion/styled';

export const Style = styled.div`
background-color: red;


* {
  margin: 0;
  padding: 0;
  border: 0 none;
  position: relative;
}

.width {
    width: 100%;
    position: relative;
    display: inline-block;
    vertical-align: top;
    box-shadow: 0 0 4px rgba(0,0,0,.3);
    align-items: center;
    justify-content: center;

}
.width:before {
    content: '';
    display: block;
}

.ratio16-9:before {padding-top: 56.25%;}

.grid {
  position: absolute;
  top: 0; left: 0; bottom: 0; right: 0;
  color: #444;
  display: grid;
  grid-template-columns: [video-col-start] 64vw [video-col-end info-col-start] 1fr [info-col-end];
  grid-template-rows: [video-row-start] 36vw [video-row-end typing-row-start] 1fr [typing-row-end];
}

.video {
  grid-column: video-col-start / video-col-end;
  grid-row: video-row-start / video-row-end;
  background-color: black;
}

.typing {
  grid-column: video-col-start / video-col-end;
  grid-row: typing-row-start / typing-row-end;
  background-color: yellow;
  padding: 1%;
  
  display: flex;
  align-items: center;
}

.box {
  overflow: hidden;
 }
 
 .container {
  align-items: center;
  justify-content: center;
 }

.spacer {
  flex-grow: 1;
}

.info {
  grid-column: info-col-start / info-col-end;
  grid-row: video-row-start / typing-row-end;
  background-color: green;
  display: flex;
  flex-direction: column;
}

.blue {
  grid-column: info-col-start / info-col-end;
  grid-row: video-row-start / typing-row-end;
  background-color: blue;
}

`;
