package ma.promedpara.owner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MonitorService extends Service {
    private static final String CHANNEL_MONITOR="promedpara_monitor", CHANNEL_ALERTS="promedpara_alerts";
    private static final int FOREGROUND_ID=4173;
    private volatile boolean running;
    private volatile HttpURLConnection currentConnection;
    private Thread worker;
    private SharedPreferences prefs;

    @Override public void onCreate(){super.onCreate();prefs=getSharedPreferences(MainActivity.PREFS,MODE_PRIVATE);createChannels();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(!prefs.getBoolean("monitoring",false)||prefs.getString("cookie","").isEmpty()){stopSelf();return START_NOT_STICKY;}
        Notification notification=monitorNotification("Connexion au poste local…");
        if(Build.VERSION.SDK_INT>=29)startForeground(FOREGROUND_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);else startForeground(FOREGROUND_ID,notification);
        if(!running){running=true;worker=new Thread(this::watch,"PromedPara-SSE");worker.start();}
        return START_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){running=false;if(worker!=null)worker.interrupt();if(currentConnection!=null)currentConnection.disconnect();((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).cancel(FOREGROUND_ID);super.onDestroy();}

    private void createChannels(){if(Build.VERSION.SDK_INT<26)return;NotificationManager m=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);m.createNotificationChannel(new NotificationChannel(CHANNEL_MONITOR,"Surveillance PromedPara",NotificationManager.IMPORTANCE_LOW));m.createNotificationChannel(new NotificationChannel(CHANNEL_ALERTS,"Alertes PromedPara",NotificationManager.IMPORTANCE_HIGH));}
    private Notification monitorNotification(String message){Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL_MONITOR):new Notification.Builder(this);return b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("PromedPara · surveillance locale").setContentText(message).setContentIntent(pending).setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).build();}
    private void setStatus(String value){NotificationManager m=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);m.notify(FOREGROUND_ID,monitorNotification(value));}
    private void alert(String title,String body,long sequence){NotificationManager m=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);Intent open=new Intent(this,MainActivity.class);PendingIntent pending=PendingIntent.getActivity(this,(int)(sequence%1000000),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL_ALERTS):new Notification.Builder(this);m.notify(2000+(int)(sequence%1000000),b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).setContentIntent(pending).build());}
    private void broadcastRefresh(){Intent i=new Intent(MainActivity.ACTION_EVENT);i.setPackage(getPackageName());i.putExtra("refresh",true);sendBroadcast(i);}

    private void watch(){
        while(running&&prefs.getBoolean("monitoring",false)){
            HttpURLConnection connection=null;
            try{
                String base=prefs.getString("server","").replaceAll("/+$","");String cookie=prefs.getString("cookie","");
                connection=(HttpURLConnection)new URL(base+"/api/events").openConnection();currentConnection=connection;connection.setRequestMethod("GET");connection.setConnectTimeout(9000);connection.setReadTimeout(70000);connection.setRequestProperty("Accept","text/event-stream");connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("Cache-Control","no-cache");
                int status=connection.getResponseCode();
                if(status==401||status==403){alert("Reconnectez-vous à PromedPara","Votre session a expiré. Ouvrez l’application et connectez-vous à nouveau.",System.currentTimeMillis());prefs.edit().putBoolean("monitoring",false).remove("cookie").apply();running=false;broadcastRefresh();break;}
                if(status<200||status>=300)throw new Exception("HTTP "+status);
                setStatus("Connecté au poste · écoute des événements");
                try(BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8))){
                    String line;StringBuilder data=new StringBuilder();boolean ready=false;
                    while(running&&prefs.getBoolean("monitoring",false)&&(line=reader.readLine())!=null){
                        if(line.startsWith("data:")){if(data.length()>0)data.append('\n');data.append(line.substring(5).trim());}
                        else if(line.isEmpty()&&data.length()>0){JSONObject event=new JSONObject(data.toString());data.setLength(0);
                            if("ready".equals(event.optString("type"))){
                                ready=true;long initial=event.optLong("sequence",0);if(!prefs.contains("last_seq"))prefs.edit().putLong("last_seq",initial).apply();else syncMissed();
                            }else if("notification".equals(event.optString("type"))){handleNotification(event.optJSONObject("notification"));}
                        }
                    }
                    if(!ready)throw new Exception("La connexion au poste a été fermée.");
                }
                if(running)setStatus("Connexion interrompue · reconnexion automatique…");
            }catch(Exception error){if(running)setStatus("Poste hors réseau · nouvelle tentative automatique…");}
            finally{if(connection!=null)connection.disconnect();if(currentConnection==connection)currentConnection=null;}
            if(running&&prefs.getBoolean("monitoring",false)){try{Thread.sleep(3000);}catch(InterruptedException ignored){Thread.currentThread().interrupt();break;}}
        }
        if(!prefs.getBoolean("monitoring",false))stopSelf();
    }

    private void syncMissed(){
        try{
            String base=prefs.getString("server","").replaceAll("/+$","");String cookie=prefs.getString("cookie","");
            for(int page=0;page<10&&running;page++){
                long after=prefs.getLong("last_seq",0);MainActivity.Result result=MainActivity.request(base+"/api/notifications?afterSeq="+after,"GET",cookie,null);
                JSONObject json=new JSONObject(result.body);if(result.status<200||result.status>=300)throw new Exception("Notification sync failed");JSONArray list=json.optJSONArray("notifications");if(list==null||list.length()==0)break;
                for(int i=0;i<list.length();i++){JSONObject n=list.optJSONObject(i);handleNotification(n);}
                if(list.length()<500)break;
            }
        }catch(Exception ignored){}
    }

    private void handleNotification(JSONObject n){
        if(n==null)return;long seq=n.optLong("sequence",0);long last=prefs.getLong("last_seq",0);if(seq<=last)return;
        String title=n.optString("title","Activité PromedPara"),body=n.optString("body","");alert(title,body,seq);prefs.edit().putLong("last_seq",seq).apply();broadcastRefresh();
    }
}
