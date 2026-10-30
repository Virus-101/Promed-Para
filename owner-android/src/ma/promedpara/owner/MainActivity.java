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
    private EditText serverField, codeField, pinField;
    private android.widget.CheckBox rememberBox;
    private boolean unlocked; private long pausedAt;
    private LinearLayout root;
    private boolean receiverRegistered;
    private final BroadcastReceiver eventReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { if (intent != null && intent.getBooleanExtra("refresh", false)) loadDashboard(); }
    };

    // ---- sign-in requests from the till: an owner opening the till must approve it here
    private final android.os.Handler approvalHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean approvalDialogOpen;
    private final Runnable approvalPoll = new Runnable() {
        @Override public void run() {
            if (unlocked && prefs != null && !approvalDialogOpen) {
                io.execute(() -> {
                    try {
                        Result r = requestAuthed(prefs, "/api/login-approvals", "GET", null);
                        if (r.status == 200) {
                            org.json.JSONArray pending = new JSONObject(r.body).getJSONArray("pending");
                            if (pending.length() > 0) { final JSONObject first = pending.getJSONObject(0); runOnUiThread(() -> askApproval(first.optString("id"), first.optString("name"))); }
                        }
                    } catch (Exception ignored) { /* offline: asked again in a few seconds */ }
                });
            }
            approvalHandler.postDelayed(this, 4000);
        }
    };
    private void askApproval(final String id, String name) {
        if (approvalDialogOpen || isFinishing()) return;
        approvalDialogOpen = true;
        new android.app.AlertDialog.Builder(this).setTitle("Demande de connexion")
            .setMessage(name + " veut ouvrir la caisse. Est-ce bien vous ?").setCancelable(false)
            .setPositiveButton("Approuver", (d, w) -> answerApproval(id, "approve"))
            .setNegativeButton("Refuser", (d, w) -> answerApproval(id, "refuse")).show();
    }
    private void answerApproval(final String id, final String decision) {
        io.execute(() -> {
            try {
                Result r = requestAuthed(prefs, "/api/login-approvals/respond", "POST", new JSONObject().put("id", id).put("decision", decision).toString());
                runOnUiThread(() -> { approvalDialogOpen = false; toast(r.status == 200 ? ("approve".equals(decision) ? "Connexion approuvée." : "Connexion refusée.") : "La demande a expiré."); });
            } catch (Exception e) { runOnUiThread(() -> { approvalDialogOpen = false; toast(message(e)); }); }
        });
    }

    @Override protected void onPause() { super.onPause(); pausedAt = System.currentTimeMillis(); approvalHandler.removeCallbacks(approvalPoll); }
    @Override protected void onResume() {
        super.onResume();
        if (prefs == null) return;
        approvalHandler.removeCallbacks(approvalPoll); approvalHandler.postDelayed(approvalPoll, 1500);
        if (unlocked && pausedAt > 0 && System.currentTimeMillis() - pausedAt > 120000 && !prefs.getString("deviceToken", "").isEmpty()) { unlocked = false; pausedAt = 0; showUnlock(); return; }
        Updater.check(this, prefs.getString("server", ""), "PromedPara-Owner.apk");
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        SystemBars.apply(this, HEADER, BG);
        if (prefs.getString("deviceToken", "").isEmpty()) showLogin(); else showUnlock();
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
    private static final int PIN_NUMBERS = InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD, PIN_TEXT = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD;
    /** The personal code is usually digits: open the number pad, with a switch to the full keyboard for codes that contain letters. */
    private EditText pinInput(String hint) {
        EditText e = field(hint, prefs.getBoolean("pinKeyboardText", false) ? PIN_TEXT : PIN_NUMBERS);
        e.setTransformationMethod(android.text.method.PasswordTransformationMethod.getInstance());
        addEye(e);
        return e;
    }
    private static android.text.method.TransformationMethod hiding(EditText e) { return Boolean.TRUE.equals(e.getTag()) ? android.text.method.HideReturnsTransformationMethod.getInstance() : android.text.method.PasswordTransformationMethod.getInstance(); }
    /** An eye at the end of the code field: tap to read what was typed, tap again to hide it. */
    private void addEye(final EditText e) {
        e.setTag(Boolean.FALSE); e.setCompoundDrawablePadding(dp(8));
        final Runnable draw = () -> { Drawable d = icon(Boolean.TRUE.equals(e.getTag()) ? "eye_off" : "eye", 22, MUTED); e.setCompoundDrawablesRelative(null, null, d, null); };
        draw.run();
        e.setOnTouchListener((v, event) -> {
            if (event.getAction() == android.view.MotionEvent.ACTION_UP && event.getX() > e.getWidth() - e.getPaddingRight() - dp(46)) {
                e.setTag(!Boolean.TRUE.equals(e.getTag())); int at = e.getSelectionEnd(); e.setTransformationMethod(hiding(e)); e.setSelection(Math.max(0, Math.min(at, e.length()))); draw.run(); v.performClick(); return true;
            }
            return false;
        });
    }
    private TextView pinKeyboardSwitch(final EditText target) {
        final boolean[] text = { prefs.getBoolean("pinKeyboardText", false) };
        final TextView t = text(text[0] ? "Revenir au clavier chiffres" : "Mon code contient des lettres : clavier complet", 13, GREEN_BRIGHT, true); t.setPadding(0, dp(10), 0, dp(2));
        t.setOnClickListener(v -> {
            text[0] = !text[0]; prefs.edit().putBoolean("pinKeyboardText", text[0]).apply();
            target.setInputType(text[0] ? PIN_TEXT : PIN_NUMBERS); target.setTransformationMethod(hiding(target)); target.setSelection(target.getText().length());
            t.setText(text[0] ? "Revenir au clavier chiffres" : "Mon code contient des lettres : clavier complet");
        });
        return t;
    }
    /** Tells Android's autofill (Samsung Pass, Google, any password manager) that this is an account name and a password. */
    private EditText accountField() {
        EditText e = field("Compte", InputType.TYPE_CLASS_TEXT); e.setText(prefs.getString("ownerName", "Propriétaire")); e.setFocusable(false); e.setClickable(false); e.setTextColor(MUTED);
        if (Build.VERSION.SDK_INT >= 26) { e.setAutofillHints(View.AUTOFILL_HINT_USERNAME); e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES); }
        return e;
    }
    private void markPassword(EditText e) { if (Build.VERSION.SDK_INT >= 26) { e.setAutofillHints(View.AUTOFILL_HINT_PASSWORD); e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES); } }
    /** After a successful sign-in the password manager is told the form was submitted, so it can offer to save the code. */
    private void commitAutofill() { try { if (Build.VERSION.SDK_INT >= 26) { android.view.autofill.AutofillManager manager = getSystemService(android.view.autofill.AutofillManager.class); if (manager != null) manager.commit(); } } catch (Exception ignored) { } }
    private android.widget.CheckBox rememberCheckbox() {
        android.widget.CheckBox b = new android.widget.CheckBox(this); b.setText("Mémoriser mon code sur ce téléphone (ne plus le demander)"); b.setTextSize(13); b.setTextColor(INK); b.setPadding(dp(4), dp(12), 0, dp(2)); return b;
    }
    private EditText field(String hint, int inputType) {
        EditText e = new EditText(this); e.setSingleLine(true); e.setTextSize(16); e.setHint(hint); e.setInputType(inputType); e.setTextColor(INK); e.setHintTextColor(MUTED); e.setBackground(shape(Color.WHITE,LINE,11)); pad(e,13,2,13,2);
        e.setOnFocusChangeListener((v, focused) -> { if (focused) v.postDelayed(() -> v.requestRectangleOnScreen(new android.graphics.Rect(0, -dp(70), v.getWidth(), v.getHeight() + dp(150)), false), 350); });
        return e;
    }

    private Button button(String title, boolean primary, String iconName, Runnable action) {
        Button b = new Button(this); b.setText(title); b.setTextSize(15); b.setAllCaps(false); b.setTypeface(Typeface.DEFAULT,Typeface.BOLD); int fg = primary?Color.WHITE:GREEN; b.setTextColor(fg); b.setBackground(shape(primary?GREEN_BRIGHT:Color.WHITE,primary?0:LINE,12)); b.setMinHeight(dp(54)); b.setPadding(dp(13),dp(5),dp(13),dp(5)); b.setOnClickListener(v -> action.run());
        if (iconName != null) { Drawable d = icon(iconName, 19, fg); if (d != null) { b.setCompoundDrawablesRelative(d, null, null, null); b.setCompoundDrawablePadding(dp(9)); b.setPadding(dp(22),dp(5),dp(22),dp(5)); } }
        return b;
    }

    // ---- pairing (replaces the old username + password sign-in: owners have a 6-digit code on the till, not a password)
    private EditText nameField;
    /** The usual pairing screen: only the owner's name and personal code (the internet link is built into the app). */
    private void showLogin() {
        begin("Propriétaire", "Votre boutique,\nen direct.", "Entrez le nom et le code personnel de votre compte sur la caisse. Rien d’autre.", true);
        LinearLayout card=column(); pad(card,19,15,19,19); card.setBackground(shape(Color.WHITE,LINE,17));
        LinearLayout.LayoutParams cp=lp(-1,-2); cp.setMargins(dp(16),dp(19),dp(16),dp(16)); root.addView(card,cp);
        card.addView(label("VOTRE NOM (COMME SUR LA CAISSE)"));
        nameField=field("Nom du compte",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); nameField.setText(prefs.getString("ownerName","")); if(Build.VERSION.SDK_INT>=26){nameField.setAutofillHints(View.AUTOFILL_HINT_USERNAME);nameField.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);} card.addView(nameField,lp(-1,56));
        card.addView(label("VOTRE CODE PERSONNEL")); pinField=pinInput("Code personnel"); markPassword(pinField); card.addView(pinField,lp(-1,56)); card.addView(pinKeyboardSwitch(pinField)); rememberBox=rememberCheckbox(); card.addView(rememberBox);
        Button pair=button("Connecter ce téléphone",true,"smartphone",this::pairDirect); LinearLayout.LayoutParams bp=lp(-1,58); bp.topMargin=dp(19); card.addView(pair,bp);
        Button ring=button("Demander un code à l’administrateur",false,"bell",this::askAdminByName); LinearLayout.LayoutParams rp=lp(-1,54); rp.topMargin=dp(10); card.addView(ring,rp);
        Button advanced=button("Connexion par adresse (avancé)",false,null,this::showLoginAdvanced); LinearLayout.LayoutParams ap=lp(-1,50); ap.topMargin=dp(8); card.addView(advanced,ap);
        TextView foot=text("Le code personnel se crée sur la caisse (bouton « Mon code »).  ·  Version "+appVersion(),12,MUTED,false); foot.setGravity(Gravity.CENTER); LinearLayout.LayoutParams fp=lp(-1,-2); fp.setMargins(dp(28),dp(6),dp(28),dp(22)); root.addView(foot,fp);
    }

    private void pairDirect() {
        final String name=nameField==null?"":nameField.getText().toString().trim(), pin=pinField==null?"":pinField.getText().toString().trim();
        final boolean remember=rememberBox!=null&&rememberBox.isChecked();
        if(name.length()<2){toast("Entrez votre nom (celui de votre compte sur la caisse).");return;}
        if(pin.isEmpty()){toast("Entrez votre code personnel.");return;}
        setBusy(true);
        io.execute(() -> {
            try {
                Relay.Direct direct=Relay.enrollDirect(name,pin,Build.MANUFACTURER+" "+Build.MODEL);
                Result result=direct.result; JSONObject json=new JSONObject(result.body);
                JSONObject account=json.getJSONObject("user");
                if(!"owner".equals(account.optString("role"))) throw new Exception("Ce compte n’a pas les droits propriétaire.");
                String token=json.optString("deviceToken",""), relayKey=json.optString("key","");
                if(token.isEmpty()||result.cookie.isEmpty()||relayKey.length()!=64) throw new Exception("Réponse inattendue de la caisse.");
                prefs.edit().putString("server",Relay.clean(direct.address)).putString("relayKey",relayKey).putString("cookie",result.cookie).putString("deviceToken",token).putString("ownerName",account.optString("name",name)).putBoolean("monitoring",false).remove("last_seq").apply();
                if(remember)CodeVault.save(prefs,pin); else CodeVault.forget(prefs);
                runOnUiThread(() -> { commitAutofill(); unlocked=true; setBusy(false); hideKeyboard(); showDashboard(null); });
            } catch(Exception e) { runOnUiThread(() -> {setBusy(false);toast(message(e));}); }
        });
    }

    private void askAdminByName() {
        final String name=nameField==null?"":nameField.getText().toString().trim();
        if(name.length()<2){toast("Entrez d’abord votre nom.");return;}
        setBusy(true);
        io.execute(() -> {
            try {
                Result result=Relay.ringByName(name);
                if(result.status<200||result.status>=300) throw new Exception(new JSONObject(result.body).optString("error","Demande refusée."));
                runOnUiThread(() -> { setBusy(false); toast("L’administrateur a été prévenu. Attendez son code."); });
            } catch(Exception e) { runOnUiThread(() -> {setBusy(false);toast(message(e));}); }
        });
    }

    private void showLoginAdvanced() {
        begin("Propriétaire", "Votre boutique,\nen direct.", "Connexion avancée : à utiliser seulement si l’adresse de la caisse vous a été donnée. Sinon, revenez et tapez votre nom et votre code.", true);
        LinearLayout card=column(); pad(card,19,15,19,19); card.setBackground(shape(Color.WHITE,LINE,17));
        LinearLayout.LayoutParams cp=lp(-1,-2); cp.setMargins(dp(16),dp(19),dp(16),dp(16)); root.addView(card,cp);
        card.addView(label("ADRESSE DU POSTE DE CAISSE"));
        serverField=field("http://192.168.1.10:4173",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI); serverField.setText(Relay.isRelayAddress(prefs.getString("server",""))?"":prefs.getString("server","")); card.addView(serverField,lp(-1,54));
        TextView note=text("Dans la fenêtre « Connecter mon téléphone » de la caisse : adresse locale (Wi‑Fi) ou adresse internet (https://…) pour fonctionner sans Wi‑Fi.",12,MUTED,false); LinearLayout.LayoutParams np=lp(-1,-2); np.topMargin=dp(6); card.addView(note,np);
        card.addView(label("CODE D’ASSOCIATION (12 CARACTÈRES)")); codeField=field("XXXX XXXX XXXX",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); codeField.setLetterSpacing(.12f); groupCode(codeField); card.addView(codeField,lp(-1,56));
        card.addView(label("VOTRE CODE PERSONNEL (CELUI DE LA CAISSE)")); pinField=pinInput("Code personnel"); markPassword(pinField); card.addView(pinField,lp(-1,56)); card.addView(pinKeyboardSwitch(pinField)); rememberBox=rememberCheckbox(); card.addView(rememberBox);
        Button pair=button("Associer ce téléphone",true,"smartphone",this::pair); LinearLayout.LayoutParams bp=lp(-1,58); bp.topMargin=dp(19); card.addView(pair,bp);
        Button ring=button("Demander un code à l’administrateur",false,"bell",this::askAdminForCode); LinearLayout.LayoutParams rp=lp(-1,54); rp.topMargin=dp(10); card.addView(ring,rp);
        Button back=button("Retour : nom et code personnel",false,null,this::showLogin); LinearLayout.LayoutParams bk=lp(-1,50); bk.topMargin=dp(8); card.addView(back,bk);
        LinearLayout steps=column(); pad(steps,19,14,19,14); steps.setBackground(shape(Color.rgb(233,243,236),0,14)); LinearLayout.LayoutParams stp=lp(-1,-2); stp.setMargins(dp(16),0,dp(16),dp(12)); root.addView(steps,stp);
        TextView st=text("Comment obtenir le code ?",13,INK,true); steps.addView(st);
        TextView how=text("Sur la caisse : bouton « Connecter mon téléphone ». Le code est valable cinq minutes et ne sert qu’une fois. Ensuite le téléphone reste associé : plus besoin de code ni de mot de passe.",12,MUTED,false); how.setLineSpacing(dp(3),1f); LinearLayout.LayoutParams hw=lp(-1,-2); hw.topMargin=dp(5); steps.addView(how,hw);
        TextView foot=text("Données et base SQLite conservées sur le poste. Connexion locale uniquement.  ·  Version "+appVersion(),12,MUTED,false); foot.setGravity(Gravity.CENTER); LinearLayout.LayoutParams fp=lp(-1,-2); fp.setMargins(dp(28),dp(6),dp(28),dp(22)); root.addView(foot,fp);
    }

    /** The owner cannot sign in at the till: ring the administrator, whose phone gets a notification with a request for a code. */
    private void askAdminForCode() {
        final String base = normalize(serverField.getText().toString());
        if (base.isEmpty()) { toast("Entrez d’abord l’adresse de la caisse que l’administrateur vous a envoyée."); return; }
        final EditText who = new EditText(this); who.setHint("Votre nom"); who.setSingleLine(true);
        new android.app.AlertDialog.Builder(this).setTitle("Demander un code à l’administrateur")
            .setMessage("L’administrateur reçoit une notification avec votre nom et vous envoie un code d’association.").setView(who)
            .setNegativeButton("Annuler", null)
            .setPositiveButton("Envoyer", (d, w) -> {
                final String name = who.getText().toString().trim();
                if (name.length() < 2) { toast("Indiquez votre nom."); return; }
                setBusy(true);
                io.execute(() -> {
                    try {
                        Result result = Relay.isRelayAddress(base) ? Relay.ring(base, name) : request(base + "/api/ring", "POST", null, new JSONObject().put("name", name).toString());
                        if (result.status < 200 || result.status >= 300) throw new Exception(new JSONObject(result.body).optString("error", "Demande refusée."));
                        runOnUiThread(() -> { setBusy(false); toast("L’administrateur a été prévenu. Attendez son code."); });
                    } catch (Exception e) { runOnUiThread(() -> { setBusy(false); toast(message(e)); }); }
                });
            }).show();
    }

    private void pair() {
        String base=normalize(serverField.getText().toString()), code=codeField.getText().toString().toUpperCase(Locale.ROOT).replaceAll("[^A-F0-9]","");
        final String pin=pinField==null?"":pinField.getText().toString().trim();
        final boolean remember=rememberBox!=null&&rememberBox.isChecked();
        if(base.isEmpty() || code.length()!=12){toast("Entrez l’adresse du poste et le code d’association à 12 caractères.");return;}
        if(pin.isEmpty()){toast("Entrez aussi votre code personnel (celui que vous tapez sur la caisse).");return;}
        prefs.edit().putString("server",base).apply();
        setBusy(true);
        io.execute(() -> {
            try {
                JSONObject body=new JSONObject().put("code",code).put("pin",pin).put("deviceName",Build.MANUFACTURER+" "+Build.MODEL);
                Result result=Relay.isRelayAddress(base)?Relay.enroll(base,code,body.toString()):request(base+"/api/owner/enroll","POST",null,body.toString());
                JSONObject json=new JSONObject(result.body);
                if(result.status<200||result.status>=300) throw new Exception(json.optString("error","Association impossible."));
                JSONObject account=json.getJSONObject("user");
                if(!"owner".equals(account.optString("role"))) throw new Exception("Ce compte n’a pas les droits propriétaire.");
                String token=json.optString("deviceToken","");
                if(token.isEmpty()||result.cookie.isEmpty()) throw new Exception("Réponse inattendue du poste.");
                if(Relay.isRelayAddress(base)){String relayKey=json.optString("key","");if(relayKey.length()!=64)throw new Exception("Réponse inattendue de la caisse.");prefs.edit().putString("relayKey",relayKey).apply();}else prefs.edit().remove("relayKey").apply();
                prefs.edit().putString("cookie",result.cookie).putString("deviceToken",token).putString("ownerName",account.optString("name","Propriétaire")).putBoolean("monitoring",false).remove("last_seq").apply();
                if(remember)CodeVault.save(prefs,pin); else CodeVault.forget(prefs);
                runOnUiThread(() -> { commitAutofill(); unlocked=true; setBusy(false); hideKeyboard(); showDashboard(null); });
            } catch(Exception e) { runOnUiThread(() -> {setBusy(false);toast(message(e));}); }
        });
    }

    /** Opening the app (or coming back after two minutes) asks for the owner's personal code, checked by the till. */
    private void showUnlock() {
        unlocked=false;
        begin("Propriétaire","Application verrouillée","Entrez votre code personnel (celui de la caisse) pour voir votre boutique.",false);
        LinearLayout card=column(); pad(card,19,15,19,19); card.setBackground(shape(Color.WHITE,LINE,17));
        LinearLayout.LayoutParams cp=lp(-1,-2); cp.setMargins(dp(16),dp(19),dp(16),dp(16)); root.addView(card,cp);
        if(CodeVault.has(prefs)){ TextView auto=text("Déverrouillage automatique avec le code mémorisé…",13,MUTED,false); auto.setPadding(0,0,0,dp(8)); card.addView(auto); }
        card.addView(label("COMPTE")); LinearLayout.LayoutParams ap=lp(-1,54); ap.bottomMargin=dp(6); card.addView(accountField(),ap); card.addView(label("VOTRE CODE PERSONNEL"));
        pinField=pinInput("Code personnel"); markPassword(pinField); pinField.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE);
        pinField.setOnEditorActionListener((v,actionId,event)->{unlock();return true;});
        card.addView(pinField,lp(-1,56)); card.addView(pinKeyboardSwitch(pinField)); rememberBox=rememberCheckbox(); card.addView(rememberBox);
        Button go=button("Déverrouiller",true,"lock_keyhole",this::unlock); LinearLayout.LayoutParams gp=lp(-1,58); gp.topMargin=dp(19); card.addView(go,gp);
        Button forgot=button("J’ai oublié mon code : réassocier ce téléphone",false,"smartphone",()->new android.app.AlertDialog.Builder(this).setTitle("Réassocier ce téléphone ?").setMessage("Le téléphone sera dissocié de la caisse. Il faudra un nouveau code d’association (bouton « Connecter mon téléphone » sur la caisse) et votre code personnel. Si vous avez oublié votre code, utilisez « Mon code » sur la caisse.").setNegativeButton("Annuler",null).setPositiveButton("Réassocier",(d,w)->logout()).show());
        LinearLayout.LayoutParams fp=lp(-1,54); fp.topMargin=dp(10); card.addView(forgot,fp);
        if(CodeVault.has(prefs)) biometricThenAutoUnlock();
        pinField.requestFocus();
        new android.os.Handler().postDelayed(()->{try{((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(pinField,0);}catch(Exception ignored){}},300);
    }
    /** A remembered code is only used after the person proves they are there: fingerprint, face or the phone's screen lock (Android 11+). */
    private void biometricThenAutoUnlock() {
        if (Build.VERSION.SDK_INT < 30) { autoUnlock(); return; }
        try {
            final android.hardware.biometrics.BiometricManager manager = getSystemService(android.hardware.biometrics.BiometricManager.class);
            final int allowed = android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_STRONG | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            if (manager == null || manager.canAuthenticate(allowed) != android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS) { autoUnlock(); return; }   // no screen lock on the phone: nothing to ask
            android.hardware.biometrics.BiometricPrompt prompt = new android.hardware.biometrics.BiometricPrompt.Builder(this)
                .setTitle("PromedPara").setSubtitle("Empreinte, visage ou code du téléphone pour ouvrir votre boutique").setAllowedAuthenticators(allowed).build();
            prompt.authenticate(new android.os.CancellationSignal(), getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) { autoUnlock(); }
                @Override public void onAuthenticationError(int code, CharSequence message) { /* cancelled or refused: the typed lock screen stays */ }
            });
        } catch (Exception e) { autoUnlock(); }
    }
    /** With a remembered code the app opens by itself: the saved code is sent to the till exactly as if it had been typed. */
    private void autoUnlock() {
        io.execute(() -> {
            String code=CodeVault.read(prefs);
            if(code==null){ CodeVault.forget(prefs); return; }
            try {
                Result r=call(prefs,"/api/owner/unlock","POST",null,new JSONObject().put("deviceToken",prefs.getString("deviceToken","")).put("pin",code).toString());
                if(r.status>=200&&r.status<300&&!r.cookie.isEmpty()){ prefs.edit().putString("cookie",r.cookie).apply(); runOnUiThread(() -> { unlocked=true; hideKeyboard(); showDashboard(null); }); return; }
                String msg=new JSONObject(r.body).optString("error","");
                if(r.status==401&&msg.contains("non reconnu")){ prefs.edit().remove("cookie").remove("alertCookie").remove("deviceToken").remove("relayKey").putBoolean("monitoring",false).apply(); CodeVault.forget(prefs); runOnUiThread(() -> { toast(msg); showLogin(); }); return; }
                if(r.status==401){ CodeVault.forget(prefs); runOnUiThread(() -> toast("Votre code a changé sur la caisse : entrez-le à nouveau.")); }
            } catch(Exception offline) { runOnUiThread(() -> { unlocked=true; showDashboard(null); }); }   // caisse injoignable : le tableau de bord propose « Réessayer »
        });
    }
    private void unlock() {
        final String pin=pinField==null?"":pinField.getText().toString().trim();
        final boolean remember=rememberBox!=null&&rememberBox.isChecked();
        if(pin.isEmpty()){toast("Entrez votre code personnel.");return;}
        pinField.setEnabled(false);
        io.execute(() -> {
            try {
                Result r=call(prefs,"/api/owner/unlock","POST",null,new JSONObject().put("deviceToken",prefs.getString("deviceToken","")).put("pin",pin).toString());
                if(r.status>=200&&r.status<300&&!r.cookie.isEmpty()){ prefs.edit().putString("cookie",r.cookie).apply(); if(remember)CodeVault.save(prefs,pin); runOnUiThread(() -> { commitAutofill(); unlocked=true; hideKeyboard(); showDashboard(null); }); return; }
                final String msg=new JSONObject(r.body).optString("error","Code incorrect.");
                if(r.status==401&&msg.contains("non reconnu")){ prefs.edit().remove("cookie").remove("alertCookie").remove("deviceToken").remove("relayKey").putBoolean("monitoring",false).apply(); runOnUiThread(() -> { toast(msg); showLogin(); }); return; }
                runOnUiThread(() -> { pinField.setEnabled(true); pinField.setText(""); pinField.requestFocus(); toast(msg); });
            } catch(Exception e) { runOnUiThread(() -> { pinField.setEnabled(true); toast(message(e)); }); }
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
        if(!prefs.getBoolean("monitoring",false)&&!prefs.getBoolean("userStopped",false)&&!askedAlertsThisRun){askedAlertsThisRun=true;requestNotificationPermissionAndStart();}
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
        prodQuery="";
        Button allProducts=button("Tous les produits ("+data.optInt("productCount")+")",true,"package",()->showProducts("all")); LinearLayout.LayoutParams apL=lp(-1,56); apL.topMargin=dp(14); area.addView(allProducts,apL);
        LinearLayout quick=row(); LinearLayout.LayoutParams qk=lp(-1,-2); qk.topMargin=dp(10); area.addView(quick,qk);
        Button lowBtn=button("Stock bas",false,"triangle_alert",()->showProducts("low")); LinearLayout.LayoutParams lb=new LinearLayout.LayoutParams(0,dp(52),1); lb.setMargins(0,0,dp(5),0); quick.addView(lowBtn,lb);
        Button reviewBtn=button("À réviser",false,"shield_check",()->showProducts("review")); LinearLayout.LayoutParams rv=new LinearLayout.LayoutParams(0,dp(52),1); rv.setMargins(dp(5),0,0,0); quick.addView(reviewBtn,rv);
        addSection(area,"STOCK À SURVEILLER","triangle_alert",lowStockText(data.optJSONArray("lowStock")));
        addSection(area,"FOURNISSEURS","truck",suppliersText(currentSuppliers));
        addSection(area,"ACTIVITÉ RÉCENTE","receipt",notificationsText(data.optJSONArray("notifications")));
        if(CodeVault.has(prefs)){ TextView forgetCode=text("Code mémorisé sur ce téléphone · toucher pour l’oublier",12,GREEN_BRIGHT,true); forgetCode.setGravity(Gravity.CENTER); forgetCode.setPadding(0,dp(14),0,dp(2)); forgetCode.setOnClickListener(v->{CodeVault.forget(prefs);toast("Code oublié : il sera demandé à la prochaine ouverture.");v.setVisibility(View.GONE);}); area.addView(forgetCode); }
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
        io.execute(() -> {try{Result r=requestAuthed(prefs,"/api/overview","GET",null);if(r.status==401||r.status==403){runOnUiThread(this::showUnlock);return;}JSONObject j=new JSONObject(r.body);if(r.status<200||r.status>=300)throw new Exception(j.optString("error","Chargement impossible."));JSONArray suppliers=null;try{Result sr=requestAuthed(prefs,"/api/suppliers","GET",null);if(sr.status>=200&&sr.status<300)suppliers=new JSONObject(sr.body).optJSONArray("suppliers");}catch(Exception ignored){}JSONArray finalSuppliers=suppliers;runOnUiThread(()->{currentSuppliers=finalSuppliers;showDashboard(j);});}catch(Exception e){runOnUiThread(()->toast("Connexion au poste impossible. Vérifiez le Wi‑Fi puis actualisez."));}});
    }

    // ---- the whole catalogue on the phone: search, low stock, products to review
    private String prodFilter = "all", prodQuery = ""; private int prodOffset = 0, prodTotal = 0; private long prodToken;
    private LinearLayout prodList; private TextView prodInfo; private Button prodMore;
    private void showProducts(String filter) {
        prodFilter = filter; prodOffset = 0; prodTotal = 0;
        begin("Propriétaire", "Produits", "Tout le catalogue de la caisse, le stock bas et ce qui est à réviser.", false);
        LinearLayout area = column(); pad(area, 16, 14, 16, 28); root.addView(area);
        Button back = button("Retour au tableau de bord", false, null, this::loadDashboard); area.addView(back, lp(-1, 50));
        LinearLayout chips = row(); LinearLayout.LayoutParams chp = lp(-1, -2); chp.topMargin = dp(12); area.addView(chips, chp);
        String[][] tabs = { { "all", "Tous" }, { "low", "Stock bas" }, { "review", "À réviser" } };
        for (int i = 0; i < tabs.length; i++) {
            final String key = tabs[i][0]; Button b = button(tabs[i][1], key.equals(filter), null, () -> showProducts(key));
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(48), 1); p.setMargins(i == 0 ? 0 : dp(4), 0, i == tabs.length - 1 ? 0 : dp(4), 0); chips.addView(b, p);
        }
        final EditText search = field("Chercher un produit, une catégorie ou un code", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); search.setText(prodQuery);
        LinearLayout.LayoutParams sp = lp(-1, 54); sp.topMargin = dp(12); area.addView(search, sp);
        final android.os.Handler later = new android.os.Handler(android.os.Looper.getMainLooper());
        final Runnable fire = () -> { prodQuery = search.getText().toString().trim(); prodOffset = 0; loadProducts(true); };
        search.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(android.text.Editable e) { later.removeCallbacks(fire); later.postDelayed(fire, 350); }
        });
        prodInfo = text("Chargement…", 13, MUTED, false); prodInfo.setPadding(0, dp(12), 0, dp(6)); area.addView(prodInfo);
        prodList = column(); area.addView(prodList);
        prodMore = button("Afficher plus", false, null, () -> loadProducts(false)); LinearLayout.LayoutParams mp = lp(-1, 52); mp.topMargin = dp(10); area.addView(prodMore, mp); prodMore.setVisibility(View.GONE);
        loadProducts(true);
    }
    private void loadProducts(final boolean reset) {
        final long token = ++prodToken; final int offset = reset ? 0 : prodOffset;
        io.execute(() -> {
            try {
                Result r = requestAuthed(prefs, "/api/mobile/products?filter=" + prodFilter + "&q=" + java.net.URLEncoder.encode(prodQuery, "UTF-8") + "&offset=" + offset + "&limit=60", "GET", null);
                if (r.status != 200) throw new Exception(new JSONObject(r.body).optString("error", "Liste indisponible."));
                final JSONObject data = new JSONObject(r.body);
                runOnUiThread(() -> {
                    if (token != prodToken || prodList == null) return;
                    if (reset) prodList.removeAllViews();
                    org.json.JSONArray items = data.optJSONArray("items");
                    for (int i = 0; items != null && i < items.length(); i++) prodList.addView(productRow(items.optJSONObject(i)));
                    prodOffset = offset + (items == null ? 0 : items.length()); prodTotal = data.optInt("total");
                    JSONObject counts = data.optJSONObject("counts");
                    prodInfo.setText(prodTotal + " produit(s)" + (counts == null ? "" : "  ·  " + counts.optInt("all") + " au total, " + counts.optInt("low") + " en stock bas, " + counts.optInt("out") + " épuisé(s), " + counts.optInt("review") + " à réviser"));
                    prodMore.setVisibility(prodOffset < prodTotal ? View.VISIBLE : View.GONE);
                    if (prodTotal == 0) prodInfo.setText("Aucun produit ne correspond.");
                });
            } catch (Exception e) { runOnUiThread(() -> { if (token == prodToken && prodInfo != null) prodInfo.setText(message(e)); }); }
        });
    }
    private View productRow(JSONObject p) {
        LinearLayout card = column(); pad(card, 14, 11, 14, 11); card.setBackground(shape(Color.WHITE, LINE, 13));
        LinearLayout.LayoutParams cp = lp(-1, -2); cp.topMargin = dp(8); card.setLayoutParams(cp);
        LinearLayout top = row(); card.addView(top);
        TextView name = text(p.optString("name"), 15, INK, true); LinearLayout.LayoutParams np = new LinearLayout.LayoutParams(0, -2, 1); top.addView(name, np);
        TextView price = text(money(p.optLong("priceCents")), 15, INK, true); top.addView(price);
        double qty = p.optDouble("quantity"); boolean low = p.optBoolean("low");
        String qtyText = (qty == Math.rint(qty) ? String.valueOf((long) qty) : String.valueOf(qty)) + " " + p.optString("unit") + " en stock · seuil " + (long) p.optDouble("reorder");
        TextView stock = text((p.optString("category").isEmpty() ? "" : p.optString("category") + " · ") + qtyText, 12, low ? Color.rgb(184, 79, 74) : MUTED, low); card.addView(stock);
        org.json.JSONArray issues = p.optJSONArray("issues");
        if (issues != null && issues.length() > 0) { StringBuilder sb = new StringBuilder("À réviser : "); for (int i = 0; i < issues.length(); i++) { if (i > 0) sb.append(", "); sb.append(issues.optString(i)); } TextView issue = text(sb.toString(), 12, Color.rgb(166, 110, 24), true); card.addView(issue); }
        return card;
    }

    private void requestNotificationPermissionAndStart() {
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},51);return;}startMonitoring();
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==51&&grantResults.length>0&&grantResults[0]==PackageManager.PERMISSION_GRANTED)startMonitoring();else if(requestCode==51)toast("Autorisez les notifications Android pour recevoir les alertes de vente et de stock.");}

    private boolean askedAlertsThisRun;
    private void startMonitoring() {
        prefs.edit().putBoolean("monitoring",true).remove("userStopped").apply();Intent i=new Intent(this,MonitorService.class);if(Build.VERSION.SDK_INT>=26)startForegroundService(i);else startService(i);toast("Surveillance locale démarrée.");loadDashboard();
    }
    private void stopMonitoring() { prefs.edit().putBoolean("monitoring",false).putBoolean("userStopped",true).apply();stopService(new Intent(this,MonitorService.class));toast("Surveillance arrêtée.");loadDashboard(); }
    private void logout() {
        unlocked=false; CodeVault.forget(prefs);
        prefs.edit().putBoolean("monitoring",false).apply(); stopService(new Intent(this,MonitorService.class));
        io.execute(()->{String base=prefs.getString("server","");try{call(prefs,"/api/owner/device-logout","POST",null,new JSONObject().put("deviceToken",prefs.getString("deviceToken","")).toString());}catch(Exception ignored){}try{call(prefs,"/api/logout","POST",prefs.getString("cookie",""),"{}");}catch(Exception ignored){}prefs.edit().remove("cookie").remove("alertCookie").remove("deviceToken").remove("ownerName").remove("relayKey").apply();runOnUiThread(this::showLogin);});
    }

    private void setBusy(boolean busy) { if(pinField!=null)pinField.setEnabled(!busy); if(codeField!=null)codeField.setEnabled(!busy); if(serverField!=null)serverField.setEnabled(!busy); }
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
        return call(prefs,path,method,prefs.getString("cookie",""),json);
    }
    /** Background alerts: the device token alone is enough, but it only ever opens an alerts-only session. */
    static Result requestAlerts(SharedPreferences prefs,String path,String method,String json)throws Exception {
        Result r=call(prefs,path,method,prefs.getString("alertCookie",""),json);
        if((r.status==401||r.status==403)&&refreshSession(prefs))r=call(prefs,path,method,prefs.getString("alertCookie",""),json);
        return r;
    }
    static boolean refreshSession(SharedPreferences prefs) {
        String token=prefs.getString("deviceToken",""),base=prefs.getString("server","");
        if(token.isEmpty()||base.isEmpty())return false;
        try{Result r=call(prefs,"/api/owner/device-login","POST",null,new JSONObject().put("deviceToken",token).toString());
            if(r.status>=200&&r.status<300&&!r.cookie.isEmpty()){prefs.edit().putString("alertCookie",r.cookie).apply();return true;}
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
