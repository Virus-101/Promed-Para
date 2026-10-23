package ma.promedpara.owner;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String PREFS = "promedpara_owner";
    static final String ACTION_EVENT = "ma.promedpara.owner.EVENT";
    private static final int GREEN = Color.rgb(23, 61, 44), GREEN_BRIGHT = Color.rgb(20, 125, 82), BG = Color.rgb(245, 247, 243), INK = Color.rgb(25, 48, 36), MUTED = Color.rgb(94, 110, 100), LINE = Color.rgb(220, 229, 220);
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private JSONArray currentSuppliers;
    private EditText serverField, usernameField, passwordField;
    private LinearLayout root;
    private boolean receiverRegistered;
    private final BroadcastReceiver eventReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { if (intent != null && intent.getBooleanExtra("refresh", false)) loadDashboard(); }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 23) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        if (prefs.getString("cookie", "").isEmpty()) showLogin(); else verifySession();
    }

    @Override protected void onStart() {
        super.onStart();
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(ACTION_EVENT);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(eventReceiver, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(eventReceiver, filter);
            receiverRegistered = true;
        }
    }

    @Override protected void onStop() { if (receiverRegistered) { unregisterReceiver(eventReceiver); receiverRegistered = false; } super.onStop(); }
    @Override protected void onDestroy() { io.shutdownNow(); super.onDestroy(); }

    private int dp(float n) { return (int) (n * getResources().getDisplayMetrics().density + .5f); }
    private GradientDrawable shape(int color, int stroke, int radius) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); if (stroke != 0) d.setStroke(dp(1), stroke); return d; }
    private TextView text(String value, int size, int color, boolean bold) { TextView t = new TextView(this); t.setText(value); t.setTextColor(color); t.setTextSize(TypedValue.COMPLEX_UNIT_SP, size); if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD); return t; }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private LinearLayout row() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.HORIZONTAL); l.setGravity(Gravity.CENTER_VERTICAL); return l; }
    private LinearLayout.LayoutParams lp(int w, int h) { return new LinearLayout.LayoutParams(w < 0 ? w : dp(w), h < 0 ? h : dp(h)); }
    private void pad(View v, int left, int top, int right, int bottom) { v.setPadding(dp(left),dp(top),dp(right),dp(bottom)); }
    private TextView label(String s) { TextView t=text(s,13,MUTED,true); t.setPadding(0,dp(14),0,dp(6)); return t; }

    private void begin(String eyebrow, String title, String subtitle) {
        root = column(); root.setBackgroundColor(BG);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(root);
        setContentView(scroll);
        LinearLayout header = column(); pad(header,22,26,22,18); header.setBackgroundColor(GREEN);
        TextView brand = text("✚  PROMEDPARA  ·  ERRACHIDIA",12,Color.rgb(194,222,202),true); header.addView(brand);
        TextView small = text(eyebrow.toUpperCase(),11,Color.rgb(194,222,202),true); LinearLayout.LayoutParams sm=lp(-2,-2); sm.topMargin=dp(26); header.addView(small,sm);
        TextView h=text(title,30,Color.WHITE,true); LinearLayout.LayoutParams hp=lp(-1,-2); hp.topMargin=dp(4); header.addView(h,hp);
        TextView sub=text(subtitle,14,Color.rgb(223,235,224),false); LinearLayout.LayoutParams sp=lp(-1,-2); sp.topMargin=dp(5); header.addView(sub,sp);
        root.addView(header);
    }

    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this); e.setSingleLine(true); e.setTextSize(16); e.setHint(hint); e.setInputType(inputType); e.setTextColor(INK); e.setHintTextColor(MUTED); e.setBackground(shape(Color.WHITE,LINE,11)); pad(e,13,2,13,2); return e;
    }

    private Button button(String title, boolean primary, Runnable action) {
        Button b = new Button(this); b.setText(title); b.setTextSize(15); b.setAllCaps(false); b.setTypeface(Typeface.DEFAULT,Typeface.BOLD); b.setTextColor(primary?Color.WHITE:GREEN); b.setBackground(shape(primary?GREEN_BRIGHT:Color.WHITE,primary?0:LINE,12)); b.setMinHeight(dp(54)); b.setPadding(dp(13),dp(5),dp(13),dp(5)); b.setOnClickListener(v -> action.run()); return b;
    }

    private void showLogin() {
        begin("Propriétaire", "Votre boutique,\nen direct.", "Connectez-vous au poste de caisse sur le Wi‑Fi de la boutique.");
        LinearLayout card=column(); pad(card,19,15,19,19); card.setBackground(shape(Color.WHITE,LINE,17));
        LinearLayout.LayoutParams cp=lp(-1,-2); cp.setMargins(dp(16),dp(19),dp(16),dp(28)); root.addView(card,cp);
        card.addView(label("ADRESSE DU POSTE DE CAISSE"));
        serverField=field("http://192.168.1.10:4173",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); serverField.setText(prefs.getString("server","")); card.addView(serverField,lp(-1,54));
        TextView note=text("Sur la page de téléchargement, copiez l’adresse locale affichée.",12,MUTED,false); LinearLayout.LayoutParams np=lp(-1,-2); np.topMargin=dp(6); card.addView(note,np);
        card.addView(label("IDENTIFIANT PROPRIÉTAIRE")); usernameField=field("Votre identifiant",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PERSON_NAME); usernameField.setText(prefs.getString("username","")); card.addView(usernameField,lp(-1,54));
        card.addView(label("MOT DE PASSE")); passwordField=field("Votre mot de passe",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD); card.addView(passwordField,lp(-1,54));
        Button login=button("Se connecter",true,this::login); LinearLayout.LayoutParams bp=lp(-1,58); bp.topMargin=dp(19); card.addView(login,bp);
        TextView foot=text("Données et base SQLite conservées sur le poste. Connexion locale uniquement.",12,MUTED,false); foot.setGravity(Gravity.CENTER); LinearLayout.LayoutParams fp=lp(-1,-2); fp.setMargins(dp(28),0,dp(28),dp(22)); root.addView(foot,fp);
    }

    private void login() {
        String base=normalize(serverField.getText().toString()), user=usernameField.getText().toString().trim(), pass=passwordField.getText().toString();
        if(base.isEmpty() || user.isEmpty() || pass.isEmpty()){toast("Entrez l’adresse du poste, l’identifiant et le mot de passe.");return;}
        prefs.edit().putString("server",base).putString("username",user).apply();
        setBusy(true);
        io.execute(() -> {
            try {
                JSONObject body=new JSONObject().put("username",user).put("password",pass);
                Result result=request(base+"/api/login","POST",null,body.toString());
                JSONObject json=new JSONObject(result.body);
                if(result.status<200||result.status>=300) throw new Exception(json.optString("error","Connexion impossible."));
                JSONObject account=json.getJSONObject("user");
                if(!"owner".equals(account.optString("role"))) throw new Exception("Ce compte n’a pas les droits propriétaire.");
                String cookie=result.cookie;
                if(cookie.isEmpty()) throw new Exception("Le poste n’a pas renvoyé de session de connexion.");
                prefs.edit().putString("cookie",cookie).putString("ownerName",account.optString("name","Propriétaire")).putBoolean("monitoring",false).remove("last_seq").apply();
                runOnUiThread(() -> { setBusy(false); hideKeyboard(); showDashboard(null); });
            } catch(Exception e) { runOnUiThread(() -> {setBusy(false);toast(message(e));}); }
        });
    }

    private void verifySession() {
        io.execute(() -> {
            try { Result r=request(prefs.getString("server","")+"/api/me","GET",prefs.getString("cookie",""),null); JSONObject j=new JSONObject(r.body); if(r.status<200||r.status>=300||!"owner".equals(j.optJSONObject("user").optString("role")))throw new Exception("Session expirée"); runOnUiThread(() -> showDashboard(null)); }
            catch(Exception e){prefs.edit().remove("cookie").putBoolean("monitoring",false).apply();runOnUiThread(this::showLogin);}
        });
    }

    private void showDashboard(JSONObject data) {
        String name=prefs.getString("ownerName","Propriétaire");
        begin("Vue propriétaire", "Bonjour, "+name+".", "Résumé et alertes du poste PromedPara.");
        LinearLayout area=column(); pad(area,16,17,16,28); root.addView(area);
        if(data==null){TextView loading=text("Chargement des ventes et du stock…",14,MUTED,false);area.addView(loading);Button retry=button("Réessayer",true,this::loadDashboard);LinearLayout.LayoutParams rp=lp(-1,54);rp.topMargin=dp(12);area.addView(retry,rp);Button logout=button("Déconnexion",false,this::logout);LinearLayout.LayoutParams op=lp(-1,52);op.topMargin=dp(8);area.addView(logout,op);loadDashboard();return;}
        LinearLayout metrics=row(); area.addView(metrics);
        addMetric(metrics,"VENTES AUJOURD’HUI",money(data.optLong("revenueCents")),data.optInt("salesCount")+" ticket(s)",true);
        addMetric(metrics,"PRODUITS",String.valueOf(data.optInt("productCount")),data.optJSONArray("lowStock")==null?"Catalogue":"Stock local",false);
        LinearLayout secondMetrics=row(); LinearLayout.LayoutParams sm=lp(-1,-2); sm.topMargin=dp(10); area.addView(secondMetrics,sm);
        int lows=data.optJSONArray("lowStock")==null?0:data.optJSONArray("lowStock").length(); addMetric(secondMetrics,"STOCK BAS",String.valueOf(lows),"À réapprovisionner",false);
        addMetric(secondMetrics,"RÉSEAU","Local","Même Wi‑Fi",true);
        LinearLayout controls=column(); pad(controls,15,14,15,15); controls.setBackground(shape(Color.WHITE,LINE,15)); LinearLayout.LayoutParams cc=lp(-1,-2);cc.topMargin=dp(14);area.addView(controls,cc);
        TextView ch=text("ALERTES EN DIRECT",14,INK,true); controls.addView(ch);
        TextView status=text(prefs.getBoolean("monitoring",false)?"Surveillance active · restez sur le Wi‑Fi de la boutique.":"Surveillance arrêtée · activez-la pour recevoir les alertes.",13,MUTED,false); LinearLayout.LayoutParams st=lp(-1,-2);st.topMargin=dp(4);controls.addView(status,st);
        boolean running=prefs.getBoolean("monitoring",false);
        Button monitor=button(running?"Arrêter la surveillance":"Démarrer la surveillance",!running,()->{if(prefs.getBoolean("monitoring",false))stopMonitoring();else requestNotificationPermissionAndStart();}); LinearLayout.LayoutParams mp=lp(-1,56);mp.topMargin=dp(12);controls.addView(monitor,mp);
        LinearLayout actions=row(); LinearLayout.LayoutParams ap=lp(-1,-2);ap.topMargin=dp(10);area.addView(actions,ap);
        Button refresh=button("Actualiser",false,this::loadDashboard); LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(0,dp(52),1);rp.setMargins(0,0,dp(5),0);actions.addView(refresh,rp);
        Button logout=button("Déconnexion",false,this::logout); LinearLayout.LayoutParams lop=new LinearLayout.LayoutParams(0,dp(52),1);lop.setMargins(dp(5),0,0,0);actions.addView(logout,lop);
        addSection(area,"STOCK À SURVEILLER",lowStockText(data.optJSONArray("lowStock")));
        addSection(area,"FOURNISSEURS",suppliersText(currentSuppliers));
        addSection(area,"ACTIVITÉ RÉCENTE",notificationsText(data.optJSONArray("notifications")));
        TextView footer=text("La base de données reste sur le poste. L’application communique avec lui sur le réseau local.",12,MUTED,false); footer.setGravity(Gravity.CENTER); LinearLayout.LayoutParams ft=lp(-1,-2);ft.topMargin=dp(18);area.addView(footer,ft);
    }

    private void addMetric(LinearLayout parent,String title,String value,String caption,boolean wide) {
        LinearLayout card=column(); pad(card,12,12,12,12); card.setBackground(shape(Color.WHITE,LINE,13)); LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(116),1); if(parent.getChildCount()>0)p.setMargins(dp(8),0,0,0);parent.addView(card,p);
        card.addView(text(title,9,MUTED,true)); TextView v=text(value,22,wide?GREEN_BRIGHT:INK,true); v.setMaxLines(1); LinearLayout.LayoutParams vp=lp(-1,-2);vp.topMargin=dp(7);card.addView(v,vp);TextView c=text(caption,11,MUTED,false);LinearLayout.LayoutParams cp=lp(-1,-2);cp.topMargin=dp(3);card.addView(c,cp);
    }

    private void addSection(LinearLayout parent,String title,String content) {
        LinearLayout card=column();pad(card,15,14,15,14);card.setBackground(shape(Color.WHITE,LINE,15));LinearLayout.LayoutParams p=lp(-1,-2);p.topMargin=dp(12);parent.addView(card,p);card.addView(text(title,13,INK,true));TextView body=text(content,13,MUTED,false);body.setLineSpacing(dp(4),1f);LinearLayout.LayoutParams bp=lp(-1,-2);bp.topMargin=dp(8);card.addView(body,bp);
    }

    private String lowStockText(JSONArray a) {
        if(a==null||a.length()==0)return "Aucun produit au seuil minimum.";StringBuilder s=new StringBuilder();for(int i=0;i<Math.min(a.length(),12);i++){JSONObject p=a.optJSONObject(i);if(i>0)s.append("\n");s.append("• ").append(p.optString("name")).append("  —  ").append(num(p.optDouble("quantity"))).append(" restants · seuil ").append(num(p.optDouble("reorder_level")));}return s.toString();
    }

    private String notificationsText(JSONArray a) {
        if(a==null||a.length()==0)return "Les ventes et réceptions de stock apparaîtront ici.";StringBuilder s=new StringBuilder();for(int i=0;i<Math.min(a.length(),8);i++){JSONObject n=a.optJSONObject(i);if(i>0)s.append("\n\n");s.append("• ").append(n.optString("title")).append("\n  ").append(n.optString("body"));}return s.toString();
    }

    private String suppliersText(JSONArray a) {
        if(a==null||a.length()==0)return "Aucun fournisseur enregistré pour l’instant.";StringBuilder s=new StringBuilder();for(int i=0;i<Math.min(a.length(),15);i++){JSONObject p=a.optJSONObject(i);if(i>0)s.append("\n\n");s.append("• ").append(p.optString("name"));String category=p.optString("category","");if(!category.isEmpty())s.append(" · ").append(category);String contact=p.optString("contact","");if(!contact.isEmpty())s.append("\n  Contact : ").append(contact);String phone=p.optString("phone","");if(!phone.isEmpty())s.append("\n  Tél. : ").append(phone);String email=p.optString("email","");if(!email.isEmpty())s.append("\n  E-mail : ").append(email);String notes=p.optString("notes","");if(!notes.isEmpty())s.append("\n  ").append(notes);}return s.toString();
    }

    private void loadDashboard() {
        io.execute(() -> {try{String server=prefs.getString("server","");String cookie=prefs.getString("cookie","");Result r=request(server+"/api/overview","GET",cookie,null);JSONObject j=new JSONObject(r.body);if(r.status<200||r.status>=300)throw new Exception(j.optString("error","Chargement impossible."));JSONArray suppliers=null;try{Result sr=request(server+"/api/suppliers","GET",cookie,null);if(sr.status>=200&&sr.status<300)suppliers=new JSONObject(sr.body).optJSONArray("suppliers");}catch(Exception ignored){}JSONArray finalSuppliers=suppliers;runOnUiThread(()->{currentSuppliers=finalSuppliers;showDashboard(j);});}catch(Exception e){runOnUiThread(()->toast("Connexion au poste impossible. Vérifiez le Wi‑Fi puis actualisez."));}});
    }

    private void requestNotificationPermissionAndStart() {
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},51);return;}startMonitoring();
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==51&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)startMonitoring();else if(requestCode==51)toast("Autorisez les notifications Android pour recevoir les alertes de vente et de stock.");}

    private void startMonitoring() {
        prefs.edit().putBoolean("monitoring",true).apply();Intent i=new Intent(this,MonitorService.class);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);toast("Surveillance locale démarrée.");loadDashboard();
    }
    private void stopMonitoring() { prefs.edit().putBoolean("monitoring",false).apply();stopService(new Intent(this,MonitorService.class));toast("Surveillance arrêtée.");loadDashboard(); }
    private void logout() { stopMonitoring();io.execute(()->{try{request(prefs.getString("server","")+"/api/logout","POST",prefs.getString("cookie",""),"{}");}catch(Exception ignored){}prefs.edit().remove("cookie").remove("ownerName").apply();runOnUiThread(this::showLogin);}); }

    private void setBusy(boolean busy) { if(passwordField!=null)passwordField.setEnabled(!busy); if(usernameField!=null)usernameField.setEnabled(!busy); if(serverField!=null)serverField.setEnabled(!busy); }
    private void hideKeyboard(){try{((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(),0);}catch(Exception ignored){}}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    private String normalize(String input){String s=input.trim();if(s.isEmpty())return "";if(!s.contains("://"))s="http://"+s;if(!s.matches("(?i)^https?://[^/]+(?::\\d+)?/?$"))return "";return s.replaceAll("/+$","");}
    private String message(Exception e){return e.getMessage()==null?"Connexion impossible.":e.getMessage();}
    static String money(long cents){return String.format(java.util.Locale.FRANCE,"%.2f MAD",cents/100.0);}
    static String num(double v){return v==(long)v?String.valueOf((long)v):String.format(java.util.Locale.FRANCE,"%.2f",v);}

    static final class Result { final int status;final String body,cookie;Result(int s,String b,String c){status=s;body=b;cookie=c;} }
    static Result request(String address,String method,String cookie,String json)throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setRequestMethod(method);c.setConnectTimeout(9000);c.setReadTimeout(15000);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Connection","close");if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);if(json!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream o=c.getOutputStream()){o.write(json.getBytes(StandardCharsets.UTF_8));}}
        int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();if(in!=null){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);in.close();}String set=c.getHeaderField("Set-Cookie"),cookieOut="";if(set!=null){int end=set.indexOf(';');cookieOut=end<0?set:set.substring(0,end);}String response=new String(out.toByteArray(),StandardCharsets.UTF_8);c.disconnect();return new Result(status,response,cookieOut);
    }
}
