import React from 'react';
import {VideoPlayer, VideoPlayerProps, VideoSource} from "../App/VideoPart/VideoPlayer";

export default {
    title: 'VideoPlayer',
    components: VideoPlayer,
    excludeStories: /.*Data$/,
};

export const YoutubeMpegData: VideoSource = {
    src: "https://r6---sn-ogueln7d.googlevideo.com/videoplayback?expire=1583226261&ei=NcldXur_IZO64wLZ-47QCw&ip=118.91.217.97&id=o-AHyUQPEU2vNdg0IVxgwxvsCQQhyinrvxfvED8eoCp92w&itag=18&source=youtube&requiressl=yes&mm=31%2C29&mn=sn-ogueln7d%2Csn-ogul7n7z&ms=au%2Crdu&mv=m&mvi=5&pl=21&initcwndbps=1205000&vprv=1&mime=video%2Fmp4&gir=yes&clen=4608324&ratebypass=yes&dur=60.209&lmt=1575871229256498&mt=1583204551&fvip=3&fexp=23842630&c=WEB&txp=5431432&sparams=expire%2Cei%2Cip%2Cid%2Citag%2Csource%2Crequiressl%2Cvprv%2Cmime%2Cgir%2Cclen%2Cratebypass%2Cdur%2Clmt&lsparams=mm%2Cmn%2Cms%2Cmv%2Cmvi%2Cpl%2Cinitcwndbps&lsig=ABSNjpQwRQIgfpTHSWvG2RahNy6LUAheE3Knjhk8PT-COz_2a79J314CIQCpBXoPCr6K4yBBFuWNym1ku8WrbrpcGAKOhMNB_-Uwew%3D%3D&sig=ADKhkGMwRgIhALl6SLJnQM1geQruUYun-RQg9qu3p9LxSMoMg9OuabOxAiEAuqZbFuJ-t2QKoW7Reb1-jBzwsP-ooczLT2bAg0p78rY=",
    type: "video/mp4"
};

export const Default = () => (
    <VideoPlayer mode={"standard"} playerProps={{sources: [YoutubeMpegData]}} />
);
