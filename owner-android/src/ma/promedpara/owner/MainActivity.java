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
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
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
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String PREFS = "promedpara_owner";
    static final String ACTION_EVENT = "ma.promedpara.owner.EVENT";
    private static final int HEADER = Color.rgb(0, 0, 0);   // black header: the logo shows in pure black and white
    private static final int GREEN = Color.rgb(23, 61, 44), GREEN_BRIGHT = Color.rgb(20, 125, 82), BG = Color.rgb(245, 247, 243), INK = Color.rgb(25, 48, 36), MUTED = Color.rgb(94, 110, 100), LINE = Color.rgb(220, 229, 220), SOFT = Color.rgb(194, 222, 202);
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private JSONArray currentSuppliers;
    private EditText serverField, codeField;
    private LinearLayout root;
    private boolean receiverRegistered;
    private final BroadcastReceiver eventReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { if (intent != null && intent.getBooleanExtra("refresh", false)) loadDashboard(); }
    };

    @Override protected void onResume() { super.onResume(); if (prefs != null) Updater.check(this, prefs.getString("server", ""), "PromedPara-Owner.apk"); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        SystemBars.apply(this, HEADER, BG);
        if (prefs.getString("cookie", "").isEmpty() && prefs.getString("deviceToken", "").isEmpty()) showLogin(); else verifySession();
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

    // ---- icons and logo come from resources generated from the Lucide set and the Promed logo
    private int res(String name, String type) { return getResources().getIdentifier(name, type, getPackageName()); }
    private Drawable icon(String name, int sizeDp, int color) {
        int id = res("ic_" + name, "drawable"); if (id == 0) return null;
        Drawable d = getResources().getDrawable(id, getTheme()).mutate(); d.setTint(color); d.setBounds(0, 0, dp(sizeDp), dp(sizeDp)); return d;
    }
    private void withIcon(TextView v, String name, int sizeDp, int color, int gapDp) {
        Drawable d = icon(name, sizeDp, color); if (d == null) return;
        v.setCompoundDrawablesRelative(d, null, null, null); v.setCompoundDrawablePadding(dp(gapDp)); v.setGravity(Gravity.CENTER_VERTICAL);
    }
    /** Each dashboard icon keeps its own natural colour instead of one grey for all. */
    private static int naturalColor(String name, int fallback) {
        switch (name) {
            case "trending_up": case "wifi": case "circle_check": case "check": return Color.rgb(20, 125, 82);
            case "package": return Color.rgb(37, 99, 235);
            case "triangle_alert": return Color.rgb(217, 119, 6);
            case "truck": return Color.rgb(79, 70, 229);
            case "receipt": return Color.rgb(13, 148, 136);
            case "bell": return Color.rgb(202, 138, 4);
            case "bell_off": return Color.rgb(148, 163, 184);
            case "activity": return Color.rgb(219, 39, 119);
            default: return fallback;
        }
    }
    private ImageView iconView(String name, int sizeDp, int color) { ImageView v = new ImageView(this); Drawable d = icon(name, sizeDp, naturalColor(name, color)); if (d != null) v.setImageDrawable(d); return v; }
    private ImageView logoView(String name) { ImageView v = new ImageView(this); int id = res(name, "drawable"); if (id != 0) v.setImageResource(id); v.setAdjustViewBounds(true); v.setScaleType(ImageView.ScaleType.FIT_CENTER); return v; }
    private String appVersion() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }

    private void begin(String eyebrow, String title, String subtitle, boolean hero) {
        root = column(); root.setBackgroundColor(BG);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.addView(root);
        setContentView(scroll);
        LinearLayout header = column(); pad(header,22,hero?30:24,22,18); header.setBackgroundColor(HEADER);
        if (hero) { header.addView(logoView("logo_full_light"), lp(150,-2)); }
        else { LinearLayout brand = row(); brand.addView(logoView("logo_mark_light"), lp(40,-2)); TextView name = text("PROMED  ·  PARAPHARMACIE",12,SOFT,true); name.setPadding(dp(11),0,0,0); name.setLetterSpacing(.06f); brand.addView(name); header.addView(brand); }
        TextView small = text(eyebrow.toUpperCase(),11,SOFT,true); LinearLayout.LayoutParams sm=lp(-2,-2); sm.topMargin=dp(hero?22:26); header.addView(small,sm);
        TextView h=text(title,30,Color.WHITE,true); LinearLayout.LayoutParams hp=lp(-1,-2); hp.topMargin=dp(4); header.addView(h,hp);
        TextView sub=text(subtitle,14,Color.rgb(223,235,224),false); LinearLayout.LayoutParams sp=lp(-1,-2); sp.topMargin=dp(5); header.addView(sub,sp);
        root.addView(header);
    }

  /** Shows a pairing code as XXXX XXXX XXXX while it is typed or pasted, so nobody has to type the spaces. */
  static void groupCode(final android.widget.EditText e){e.addTextChangedListener(new android.text.TextWatcher(){boolean busy;public void beforeTextChanged(CharSequence s,int a,int b,int c){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(android.text.Editable ed){if(busy)return;busy=true;String raw=ed.toString().replaceAll("[^A-Fa-f0-9]","").toUpperCase(java.util.Locale.ROOT);if(raw.length()>12)raw=raw.substring(0,12);StringBuilder sb=new StringBuilder();for(int i=0;i<raw.length();i++){if(i>0&&i%4==0)sb.append(' ');sb.append(raw.charAt(i));}String out=sb.toString();if(!out.equals(ed.toString()))ed.replace(0,ed.length(),out);busy=false;}});}
    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this); e.setSingleLine(true); e.setTextSize(16); e.setHint(hint); e.setInputType(inputType); e.setTextColor(INK); e.setHintTextColor(MUTED); e.setBackground(shape(Color.WHITE,LINE,11)); pad(e,13,2,13,2); return e;
    }

    private Button button(String title, boolean primary, String iconName, Runnable action) {
        Button b = new Button(this); b.setText(title); b.setTextSize(15); b.setAllCaps(false); b.setTypeface(Typeface.DEFAULT,Typeface.BOLD); int fg = primary?Color.WHITE:GREEN; b.setTextColor(fg); b.setBackground(shape(primary?GREEN_BRIGHT:Color.WHITE,primary?0:LINE,12)); b.setMinHeight(dp(54)); b.setPadding(dp(13),dp(5),dp(13),dp(5)); b.setOnClickListener(v -> action.run());
        if (iconName != null) { Drawable d = icon(iconName, 19, fg); if (d != null) { b.setCompoundDrawablesRelative(d, null, null, null); b.setCompoundDrawablePadding(dp(9)); b.setPadding(dp(22),dp(5),dp(22),dp(5)); } }
        return b;
    }

    // ---- pairing (replaces the old username + password sign-in: owners have a 6-digit code on the till, not a password)
    private void showLogin() {
        begin("Propriétaire", "Votre boutique,\nen direct.", "Associez ce téléphone à la caisse : au Wi‑Fi de la boutique ou partout par internet.", true);
        LinearLayout card=column(); pad(card,19,15,19,19); card.setBackground(shape(Color.WHITE,LINE,17));
        LinearLayout.LayoutParams cp=lp(-1,-2); cp.setMargins(dp(16),dp(19),dp(16),dp(16)); root.addView(card,cp);
        card.addView(label("ADRESSE DU POSTE DE CAISSE"));
        serverField=field("http://192.168.1.10:4173",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); serverField.setText(prefs.getString("server","")); card.addView(serverField,lp(-1,54));
        TextView note=text("Dans la fenêtre « Connecter mon téléphone » de la caisse : adresse locale (Wi‑Fi) ou adresse internet (https://…) pour fonctionner sans Wi‑Fi.",12,MUTED,false); LinearLayout.LayoutParams np=lp(-1,-2); np.topMargin=dp(6); card.addView(note,np);
        card.addView(label("CODE D’ASSOCIATION (12 CARACTÈRES)")); codeField=field("XXXX XXXX XXXX",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); codeField.setLetterSpacing(.12f); groupCode(codeField); card.addView(codeField,lp(-1,56));
        Button pair=button("Associer ce téléphone",true,"smartphone",this::pair); LinearLayout.LayoutParams bp=lp(-1,58); bp.topMargin=dp(19); card.addView(pair,bp);
        LinearLayout steps=column(); pad(steps,19,14,19,14); steps.setBackground(shape(Color.rgb(233,243,236),0,14)); LinearLayout.LayoutParams stp=lp(-1,-2); stp.setMargins(dp(16),0,dp(16),dp(12)); root.addView(steps,stp);
        TextView st=text("Comment obtenir le code ?",13,INK,true); steps.addView(st);
        TextView how=text("Sur la caisse : bouton « Connecter mon téléphone ». Le code est valable cinq minutes et ne sert qu’une fois. Ensuite le téléphone reste associé : plus besoin de code ni de mot de passe.",12,MUTED,false); how.setLineSpacing(dp(3),1f); LinearLayout.LayoutParams hw=lp(-1,-2); hw.topMargin=dp(5); steps.addView(how,hw);
        TextView foot=text("Données et base SQLite conservées sur le poste. Connexion locale uniquement.  ·  Version "+appVersion(),12,MUTED,false); foot.setGravity(Gravity.CENTER); LinearLayout.LayoutParams fp=lp(-1,-2); fp.setMargins(dp(28),dp(6),dp(28),dp(22)); root.addView(foot,fp);
    }

    private void pair() {
        String base=normalize(serverField.getText().toString()), code=codeField.getText().toString().toUpperCase(Locale.ROOT).replaceAll("[^A-F0-9]","");
        if(base.isEmpty() || code.length()!=12){toast("Entrez l’adresse du poste et le code d’association à 12 caractères.");return;}
        prefs.edit().putString("server",base).apply();
        setBusy(true);
        io.execute(() -> {
            try {
                JSONObject body=new JSONObject().put("code",code).put("deviceName",Build.MANUFACTURER+" "+Build.MODEL);
                Result result=Relay.isRelayAddress(base)?Relay.enroll(base,code,body.toString()):request(base+"/api/owner/enroll","POST",null,body.toString());
                JSONObject json=new JSONObject(result.body);
                if(result.status<200||result.status>=300) throw new Exception(json.optString("error","Association impossible."));
                JSONObject account=json.getJSONObject("user");
                if(!"owner".equals(account.optString("role"))) throw new Exception("Ce compte n’a pas les droits propriétaire.");
                String token=json.optString("deviceToken","");
                if(token.isEmpty()||result.cookie.isEmpty()) throw new Exception("Réponse inattendue du poste.");
                if(Relay.isRelayAddress(base)){String relayKey=json.optString("key","");if(relayKey.length()!=64)throw new Exception("Réponse inattendue de la caisse.");prefs.edit().putString("relayKey",relayKey).apply();}else prefs.edit().remove("relayKey").apply();
                prefs.edit().putString("cookie",result.cookie).putString("deviceToken",token).putString("ownerName",account.optString("name","Propriétaire")).putBoolean("monitoring",false).remove("last_seq").apply();
                runOnUiThread(() -> { setBusy(false); hideKeyboard(); showDashboard(null); });
            } catch(Exception e) { runOnUiThread(() -> {setBusy(false);toast(message(e));}); }
        });
    }

    private void verifySession() {
        io.execute(() -> {
            try {
                Result r=requestAuthed(prefs,"/api/me","GET",null);
                if(r.status==401||r.status==403){ prefs.edit().remove("cookie").remove("deviceToken").putBoolean("monitoring",false).apply(); runOnUiThread(this::showLogin); return; }
                runOnUiThread(() -> showDashboard(null));
            } catch(Exception offline) { runOnUiThread(() -> showDashboard(null)); }   // poste injoignable : on garde l’association, le tableau de bord propose « Réessayer »
        });
    }

    private void showDashboard(JSONObject data) {
        String name=prefs.getString("ownerName","Propriétaire");
        begin("Vue propriétaire", "Bonjour, "+name+".", "Résumé et alertes du poste PromedPara.", false);
        LinearLayout area=column(); pad(area,16,17,16,28); root.addView(area);
        if(data==null){TextView loading=text("Chargement des ventes et du stock…",14,MUTED,false);withIcon(loading,"activity",18,MUTED,8);area.addView(loading);Button retry=button("Réessayer",true,"refresh_cw",this::loadDashboard);LinearLayout.LayoutParams rp=lp(-1,54);rp.topMargin=dp(12);area.addView(retry,rp);Button logout=button("Déconnexion",false,"log_out",this::logout);LinearLayout.LayoutParams op=lp(-1,52);op.topMargin=dp(8);area.addView(logout,op);loadDashboard();return;}
        LinearLayout metrics=row(); area.addView(metrics);
        addMetric(metrics,"VENTES AUJOURD’HUI",money(data.optLong("revenueCents")),data.optInt("salesCount")+" ticket(s)",true,"trending_up");
        addMetric(metrics,"PRODUITS",String.valueOf(data.optInt("productCount")),data.optJSONArray("lowStock")==null?"Catalogue":"Stock local",false,"package");
        LinearLayout secondMetrics=row(); LinearLayout.LayoutParams sm=lp(-1,-2); sm.topMargin=dp(10); area.addView(secondMetrics,sm);
        int lows=data.optJSONArray("lowStock")==null?0:data.optJSONArray("lowStock").length(); addMetric(secondMetrics,"STOCK BAS",String.valueOf(lows),"À réapprovisionner",false,"triangle_alert");
        if(Relay.isRelayAddress(prefs.getString("server","")))addMetric(secondMetrics,"RÉSEAU","Internet","Partout, sans Wi‑Fi",true,"wifi");else addMetric(secondMetrics,"RÉSEAU","Local","Même Wi‑Fi",true,"wifi");
        LinearLayout controls=column(); pad(controls,15,14,15,15); controls.setBackground(shape(Color.WHITE,LINE,15)); LinearLayout.LayoutParams cc=lp(-1,-2);cc.topMargin=dp(14);area.addView(controls,cc);
        TextView ch=text("ALERTES EN DIRECT",14,INK,true); withIcon(ch,"bell",18,GREEN_BRIGHT,8); controls.addView(ch);
        boolean running=prefs.getBoolean("monitoring",false);
        TextView status=text(running?"Surveillance active.":"Surveillance arrêtée · activez-la pour recevoir les alertes.",13,MUTED,false); LinearLayout.LayoutParams st=lp(-1,-2);st.topMargin=dp(4);controls.addView(status,st);
        Button monitor=button(running?"Arrêter la surveillance":"Démarrer la surveillance",!running,running?"bell_off":"bell",()->{if(prefs.getBoolean("monitoring",false))stopMonitoring();else requestNotificationPermissionAndStart();}); LinearLayout.LayoutParams mp=lp(-1,56);mp.topMargin=dp(12);controls.addView(monitor,mp);
        LinearLayout actions=row(); LinearLayout.LayoutParams ap=lp(-1,-2);ap.topMargin=dp(10);area.addView(actions,ap);
        Button refresh=button("Actualiser",false,"refresh_cw",this::loadDashboard); LinearLayout.LayoutParams rp=new LinearLayout.LayoutParams(0,dp(52),1);rp.setMargins(0,0,dp(5),0);actions.addView(refresh,rp);
        Button logout=button("Déconnexion",false,"log_out",this::logout); LinearLayout.LayoutParams lop=new LinearLayout.LayoutParams(0,dp(52),1);lop.setMargins(dp(5),0,0,0);actions.addView(logout,lop);
        addSection(area,"STOCK À SURVEILLER","triangle_alert",lowStockText(data.optJSONArray("lowStock")));
        addSection(area,"FOURNISSEURS","truck",suppliersText(currentSuppliers));
        addSection(area,"ACTIVITÉ RÉCENTE","receipt",notificationsText(data.optJSONArray("notifications")));
        TextView footer=text("La base de données reste sur le poste. L’application communique avec lui sur le réseau local.  ·  Version "+appVersion(),12,MUTED,false); footer.setGravity(Gravity.CENTER); LinearLayout.LayoutParams ft=lp(-1,-2);ft.topMargin=dp(18);area.addView(footer,ft);
    }

    private void addMetric(LinearLayout parent,String title,String value,String caption,boolean wide,String iconName) {
        LinearLayout card=column(); pad(card,12,12,12,12); card.setBackground(shape(Color.WHITE,LINE,13)); LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(116),1); if(parent.getChildCount()>0)p.setMargins(dp(8),0,0,0);parent.addView(card,p);
        LinearLayout head=row(); TextView t=text(title,9,MUTED,true); head.addView(t,new LinearLayout.LayoutParams(0,-2,1)); head.addView(iconView(iconName,16,wide?GREEN_BRIGHT:MUTED),lp(16,16)); card.addView(head);
        TextView v=text(value,22,wide?GREEN_BRIGHT:INK,true); v.setMaxLines(1); LinearLayout.LayoutParams vp=lp(-1,-2);vp.topMargin=dp(7);card.addView(v,vp);TextView c=text(caption,11,MUTED,false);LinearLayout.LayoutParams cp=lp(-1,-2);cp.topMargin=dp(3);card.addView(c,cp);
    }

    private void addSection(LinearLayout parent,String title,String iconName,String content) {
        LinearLayout card=column();pad(card,15,14,15,14);card.setBackground(shape(Color.WHITE,LINE,15));LinearLayout.LayoutParams p=lp(-1,-2);p.topMargin=dp(12);parent.addView(card,p);
        TextView head=text(title,13,INK,true); withIcon(head,iconName,17,GREEN_BRIGHT,8); card.addView(head);
        TextView body=text(content,13,MUTED,false);body.setLineSpacing(dp(4),1f);LinearLayout.LayoutParams bp=lp(-1,-2);bp.topMargin=dp(8);card.addView(body,bp);
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
        io.execute(() -> {try{Result r=requestAuthed(prefs,"/api/overview","GET",null);if(r.status==401||r.status==403){prefs.edit().remove("cookie").remove("deviceToken").putBoolean("monitoring",false).apply();runOnUiThread(()->{toast("Ce téléphone n’est plus associé à la caisse. Associez-le à nouveau.");showLogin();});return;}JSONObject j=new JSONObject(r.body);if(r.status<200||r.status>=300)throw new Exception(j.optString("error","Chargement impossible."));JSONArray suppliers=null;try{Result sr=requestAuthed(prefs,"/api/suppliers","GET",null);if(sr.status>=200&&sr.status<300)suppliers=new JSONObject(sr.body).optJSONArray("suppliers");}catch(Exception ignored){}JSONArray finalSuppliers=suppliers;runOnUiThread(()->{currentSuppliers=finalSuppliers;showDashboard(j);});}catch(Exception e){runOnUiThread(()->toast("Connexion au poste impossible. Vérifiez le Wi‑Fi puis actualisez."));}});
    }

    private void requestNotificationPermissionAndStart() {
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},51);return;}startMonitoring();
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==51&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)startMonitoring();else if(requestCode==51)toast("Autorisez les notifications Android pour recevoir les alertes de vente et de stock.");}

    private void startMonitoring() {
        prefs.edit().putBoolean("monitoring",true).apply();Intent i=new Intent(this,MonitorService.class);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);toast("Surveillance locale démarrée.");loadDashboard();
    }
    private void stopMonitoring() { prefs.edit().putBoolean("monitoring",false).apply();stopService(new Intent(this,MonitorService.class));toast("Surveillance arrêtée.");loadDashboard(); }
    private void logout() {
        prefs.edit().putBoolean("monitoring",false).apply(); stopService(new Intent(this,MonitorService.class));
        io.execute(()->{String base=prefs.getString("server","");try{call(prefs,"/api/owner/device-logout","POST",null,new JSONObject().put("deviceToken",prefs.getString("deviceToken","")).toString());}catch(Exception ignored){}try{call(prefs,"/api/logout","POST",prefs.getString("cookie",""),"{}");}catch(Exception ignored){}prefs.edit().remove("cookie").remove("deviceToken").remove("ownerName").remove("relayKey").apply();runOnUiThread(this::showLogin);});
    }

    private void setBusy(boolean busy) { if(codeField!=null)codeField.setEnabled(!busy); if(serverField!=null)serverField.setEnabled(!busy); }
    private void hideKeyboard(){try{((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(root.getWindowToken(),0);}catch(Exception ignored){}}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    private String normalize(String input){String s=input.trim();if(s.isEmpty())return "";if(Relay.isRelayAddress(s))return Relay.clean(s);if(!s.contains("://"))s="http://"+s;if(!s.matches("(?i)^https?://[^/]+(?::\\d+)?/?$"))return "";return s.replaceAll("/+$","");}
    private String message(Exception e){return e.getMessage()==null?"Connexion impossible.":e.getMessage();}
    static String money(long cents){return String.format(java.util.Locale.FRANCE,"%.2f MAD",cents/100.0);}
    static String num(double v){return v==(long)v?String.valueOf((long)v):String.format(java.util.Locale.FRANCE,"%.2f",v);}

    static final class Result { final int status;final String body,cookie;Result(int s,String b,String c){status=s;body=b;cookie=c;} }

    // A request with the saved session; when the till says the session expired, the paired phone signs in again by itself.
    static Result requestAuthed(SharedPreferences prefs,String path,String method,String json)throws Exception {
        String base=prefs.getString("server","");
        Result r=call(prefs,path,method,prefs.getString("cookie",""),json);
        if(r.status==401&&refreshSession(prefs))r=call(prefs,path,method,prefs.getString("cookie",""),json);
        return r;
    }
    static boolean refreshSession(SharedPreferences prefs) {
        String token=prefs.getString("deviceToken",""),base=prefs.getString("server","");
        if(token.isEmpty()||base.isEmpty())return false;
        try{Result r=call(prefs,"/api/owner/device-login","POST",null,new JSONObject().put("deviceToken",token).toString());
            if(r.status>=200&&r.status<300&&!r.cookie.isEmpty()){prefs.edit().putString("cookie",r.cookie).apply();return true;}
        }catch(Exception ignored){}
        return false;
    }
    /** One call to the till: through the internet relay when the saved address is a relay address, directly on the Wi-Fi otherwise. */
    static Result call(SharedPreferences prefs,String path,String method,String cookie,String json)throws Exception {
        String address=prefs.getString("server","");
        if(Relay.isRelayAddress(address))return Relay.call(prefs,method,path,cookie,json);
        return request(address.replaceAll("/+$","")+path,method,cookie,json);
    }
    static Result request(String address,String method,String cookie,String json)throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setRequestMethod(method);c.setConnectTimeout(9000);c.setReadTimeout(15000);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Connection","close");if(cookie!=null&&!cookie.isEmpty())c.setRequestProperty("Cookie",cookie);if(json!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream o=c.getOutputStream()){o.write(json.getBytes(StandardCharsets.UTF_8));}}
        int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();if(in!=null){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);in.close();}String set=c.getHeaderField("Set-Cookie"),cookieOut="";if(set!=null){int end=set.indexOf(';');cookieOut=end<0?set:set.substring(0,end);}String response=new String(out.toByteArray(),StandardCharsets.UTF_8);c.disconnect();return new Result(status,response,cookieOut);
    }
}
