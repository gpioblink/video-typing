import React, {useEffect} from "react";
import {Typing} from "../App/Typing";
import {PokemonJson} from "./pokemon";
import {VideoSource} from "../App/VideoPart/VideoPlayer";

export default {
    title: 'Typing',
    components: Typing,
    excludeStories: /.*Data$/,
};

export const Default = () => {
    const [state, setState] = React.useState<VideoSource[]>([]);
    const url = "https://www.youtube.com/watch?v=6xKWiCMKKJg";

    useEffect(() => {
        fetch("https://fesa02fzvb.execute-api.ap-northeast-1.amazonaws.com/default/video-typing-source-finder-ap-northeast-1", {
            method: "POST", // *GET, POST, PUT, DELETE, etc.
            mode: "cors", // no-cors, cors, *same-origin
            headers: {
                "Content-Type": "application/json; charset=utf-8",
            },
            referrer: "no-referrer", // no-referrer, *client
            body: JSON.stringify({url: url}), // 本文のデータ型は "Content-Type" ヘッダーと一致する必要があります
        })
            .then(res => {console.log(res); return res.json()})
            .then(
                (result) => {
                    setState(result.res);
                    console.log(result.res);
                },
                (error) => {
                    console.log(error);
                }
            );
    }, []);

  return <Typing caption={PokemonJson} videoSources={{sources: state}}/>
};
