import youtube_dl
import json
import time

class MyLogger(object):
    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        print(msg)

def get_sources(event, context):
    #request_json = request.get_json()
    #if 'url' in request_json.keys() == False:
    #    return json.dumps({'error': 'url was not specified'})
    # time.sleep(10)
    # return {
    #     'statusCode': 200,
    #     'headers': {
    #         "Access-Control-Allow-Origin": "*",
    #         "Access-Control-Allow-Headers": "Content-Type",
    #         "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    #     },
    #     'body': json.dumps({"res": [{"src": "https://r6---sn-ogueln7d.googlevideo.com/videoplayback?expire=1583523292&ei=e1FiXrLFOoCBs8IPj4qriAI&ip=13.231.135.76&id=o-AByR9R3IMdhYmiYty9YyqzkaZ8XL-62VCjGuAZpQaPYJ&itag=18&source=youtube&requiressl=yes&mm=31%2C29&mn=sn-ogueln7d%2Csn-ogul7n7z&ms=au%2Crdu&mv=m&mvi=5&pl=15&initcwndbps=603750&vprv=1&mime=video%2Fmp4&gir=yes&clen=4608324&ratebypass=yes&dur=60.209&lmt=1575871229256498&mt=1583501612&fvip=3&fexp=23842630&c=WEB&txp=5431432&sparams=expire%2Cei%2Cip%2Cid%2Citag%2Csource%2Crequiressl%2Cvprv%2Cmime%2Cgir%2Cclen%2Cratebypass%2Cdur%2Clmt&lsparams=mm%2Cmn%2Cms%2Cmv%2Cmvi%2Cpl%2Cinitcwndbps&lsig=ABSNjpQwRQIgRDy9-1sofZ4ITgwINrOtuOcS_bfzneTxdnrv3XRNIjACIQDZt4U0MnVzbBGYj3wsLQps1WNC1_0UDVoJf6_9bj8e-w%3D%3D&sig=ADKhkGMwRQIgeldQai_R86gopZXCaFU2akRl2Z7A9ueFRNTMJoYZtIwCIQCQhhmhMGMDmbTYg3r-lL2F1T1mVk8mE6resAV9bZIXPQ==","type": "video/mp4"}]})
    # }  


    inputs = json.loads(event['body'])

    if 'url' in inputs.keys():
        url = inputs['url']

        ydl_opts = {
            'simulate': True,
            'dump_single_json': True,
            'list_subs': True,
            'logger': MyLogger()
        }
        
        with youtube_dl.YoutubeDL(ydl_opts) as ydl:

            result = ydl.extract_info(url, download=False)            
            filtered_result = []
            for format in result['formats']:
                if format['acodec'] != 'none' and format['vcodec'] != 'none':
                    filtered_result.append({'src': format['url'], 'type': 'video/' + format['ext'] }) # TODO: fix type extraction
                    # filtered_result.append({'src': format['url'], 'type': format })
            return {
                'statusCode': 200,
                'headers': {
                    "Access-Control-Allow-Origin": "*",
                },
                'body': json.dumps({"res": filtered_result})
            }  

    return {
        'statusCode': 400,
        'headers': {
            "Access-Control-Allow-Origin": "*",
        },
        'body': json.dumps({"error": "no url was specified"})
    }

if __name__ == "__main__":
    print(get_sources({"body": "{\"url\": \"https://www.youtube.com/watch?v=6xKWiCMKKJg\"}"}, ''))