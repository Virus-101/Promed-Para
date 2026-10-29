package ma.promedpara.worker;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class MainActivity extends Activity {
  private static final String PREFS="promedpara_worker", KEY_ALIAS="PromedParaWorkerSeedV1";
  private static final int GREEN=Color.rgb(23,61,44), BRIGHT=Color.rgb(20,125,82), BG=Color.rgb(242,246,242), INK=Color.rgb(27,48,36), MUTED=Color.rgb(108,124,112), LINE=Color.rgb(220,229,220);
  private static final String CODE39="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
  private static final int[] ENCODINGS={0x034,0x121,0x061,0x160,0x031,0x130,0x070,0x025,0x124,0x064,0x109,0x049,0x148,0x019,0x118,0x058,0x00D,0x10C,0x04C,0x01C,0x103,0x043,0x142,0x013,0x112,0x052,0x007,0x106,0x046,0x016,0x181,0x0C1,0x1C0,0x091,0x190,0x0D0,0x085,0x184,0x0C4,0x0A8,0x0A2,0x08A,0x02A};
  private final ExecutorService io=Executors.newSingleThreadExecutor();
  private final Handler handler=new Handler(Looper.getMainLooper());
  private LinearLayout root;
  private EditText serverField,codeField;
  private TextView badgeCode,timerView;
  private BarcodeView barcodeView;
  private Runnable ticker;
  private String server="",deviceId="",workerName="",secretHex="";

  @Override protected void onResume(){super.onResume();Updater.check(this,getPreferences(0).getString("server",""),"PromedPara-Worker.apk");}
  @Override public void onCreate(Bundle state){super.onCreate(state);SystemBars.apply(this,GREEN,BG);loadSaved();if(secretHex.isEmpty())showPair();else showBadge();}
  @Override protected void onDestroy(){if(ticker!=null)handler.removeCallbacks(ticker);io.shutdownNow();super.onDestroy();}
  private int dp(float n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
  private GradientDrawable shape(int color,int stroke,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));if(stroke!=0)d.setStroke(dp(1),stroke);return d;}
  private LinearLayout column(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;}
  private TextView text(String value,int size,int color,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextColor(color);t.setTextSize(TypedValue.COMPLEX_UNIT_SP,size);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
  private int res(String name,String type){return getResources().getIdentifier(name,type,getPackageName());}
  private Drawable icon(String name,int sizeDp,int color){int id=res("ic_"+name,"drawable");if(id==0)return null;Drawable d=getResources().getDrawable(id,getTheme()).mutate();d.setTint(color);d.setBounds(0,0,dp(sizeDp),dp(sizeDp));return d;}
  private void withIcon(TextView v,String name,int sizeDp,int color,int gapDp){Drawable d=icon(name,sizeDp,color);if(d==null)return;v.setCompoundDrawablesRelative(d,null,null,null);v.setCompoundDrawablePadding(dp(gapDp));v.setGravity(Gravity.CENTER_VERTICAL);}
  private ImageView logoView(String name){ImageView v=new ImageView(this);int id=res(name,"drawable");if(id!=0)v.setImageResource(id);v.setAdjustViewBounds(true);v.setScaleType(ImageView.ScaleType.FIT_CENTER);return v;}
  private String appVersion(){try{return getPackageManager().getPackageInfo(getPackageName(),0).versionName;}catch(Exception e){return "";}}
  private void pad(View v,int l,int t,int r,int b){v.setPadding(dp(l),dp(t),dp(r),dp(b));}
  private LinearLayout.LayoutParams lp(int w,int h){return new LinearLayout.LayoutParams(w<0?w:dp(w),h<0?h:dp(h));}
  private void begin(){getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);LinearLayout page=column();page.setBackgroundColor(BG);ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(page);setContentView(scroll);LinearLayout header=column();header.setBackgroundColor(GREEN);pad(header,22,22,22,22);LinearLayout brandRow=new LinearLayout(this);brandRow.setOrientation(LinearLayout.HORIZONTAL);brandRow.setGravity(Gravity.CENTER_VERTICAL);brandRow.addView(logoView("logo_mark_light"),lp(40,-2));TextView brand=text("PROMED  ·  PARAPHARMACIE",13,Color.rgb(194,222,202),true);brand.setLetterSpacing(.06f);brand.setPadding(dp(11),0,0,0);brandRow.addView(brand);header.addView(brandRow);page.addView(header);root=column();pad(root,16,18,16,24);page.addView(root);}
  private TextView label(String value){TextView t=text(value,12,MUTED,true);t.setPadding(0,dp(14),0,dp(6));return t;}
  /** Shows a pairing code as XXXX XXXX XXXX while it is typed or pasted, so nobody has to type the spaces. */
  static void groupCode(final android.widget.EditText e){e.addTextChangedListener(new android.text.TextWatcher(){boolean busy;public void beforeTextChanged(CharSequence s,int a,int b,int c){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(android.text.Editable ed){if(busy)return;busy=true;String raw=ed.toString().replaceAll("[^A-Fa-f0-9]","").toUpperCase(java.util.Locale.ROOT);if(raw.length()>12)raw=raw.substring(0,12);StringBuilder sb=new StringBuilder();for(int i=0;i<raw.length();i++){if(i>0&&i%4==0)sb.append(' ');sb.append(raw.charAt(i));}String out=sb.toString();if(!out.equals(ed.toString()))ed.replace(0,ed.length(),out);busy=false;}});}
  private EditText field(String hint,int inputType){EditText e=new EditText(this);e.setSingleLine(true);e.setTextSize(16);e.setHint(hint);e.setInputType(inputType);e.setTextColor(INK);e.setHintTextColor(MUTED);e.setBackground(shape(Color.WHITE,LINE,11));pad(e,13,2,13,2);return e;}
  private Button button(String title,boolean primary,String iconName,Runnable action){Button b=button(title,primary,action);Drawable d=icon(iconName,19,primary?Color.WHITE:GREEN);if(d!=null){b.setCompoundDrawablesRelative(d,null,null,null);b.setCompoundDrawablePadding(dp(9));b.setPadding(dp(22),dp(5),dp(22),dp(5));}return b;}
  private Button button(String title,boolean primary,Runnable action){Button b=new Button(this);b.setText(title);b.setTextSize(15);b.setAllCaps(false);b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);b.setTextColor(primary?Color.WHITE:GREEN);b.setBackground(shape(primary?BRIGHT:Color.WHITE,primary?0:LINE,12));b.setMinHeight(dp(54));b.setPadding(dp(12),dp(5),dp(12),dp(5));b.setOnClickListener(v->action.run());return b;}
  private void showPair(){begin();TextView eyebrow=text("PREMIÈRE UTILISATION",11,BRIGHT,true);root.addView(eyebrow);TextView title=text("Associer mon téléphone",27,INK,true);LinearLayout.LayoutParams tp=lp(-1,-2);tp.topMargin=dp(5);root.addView(title,tp);TextView intro=text("Saisissez l’adresse du poste et le code temporaire remis par le propriétaire.",14,MUTED,false);LinearLayout.LayoutParams ip=lp(-1,-2);ip.topMargin=dp(6);root.addView(intro,ip);
    LinearLayout card=column();pad(card,18,13,18,18);card.setBackground(shape(Color.WHITE,LINE,16));LinearLayout.LayoutParams cp=lp(-1,-2);cp.topMargin=dp(19);root.addView(card,cp);
    card.addView(label("ADRESSE DU POSTE PROMEDPARA"));serverField=field("http://192.168.1.10:4173",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);serverField.setText(getPreferences(0).getString("server",""));card.addView(serverField,lp(-1,54));
    TextView serverHelp=text("Copiez l’adresse locale affichée par le propriétaire, sans /worker.",11,MUTED,false);LinearLayout.LayoutParams sh=lp(-1,-2);sh.topMargin=dp(5);card.addView(serverHelp,sh);
    card.addView(label("CODE D’ASSOCIATION À USAGE UNIQUE"));codeField=field("XXXX XXXX XXXX",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);codeField.setLetterSpacing(.12f);groupCode(codeField);card.addView(codeField,lp(-1,56));
    TextView error=text("",12,Color.rgb(174,58,49),false);LinearLayout.LayoutParams ep=lp(-1,-2);ep.topMargin=dp(6);card.addView(error,ep);
    Button pair=button("Associer ce téléphone",true,"smartphone",()->enroll(error));LinearLayout.LayoutParams bp=lp(-1,58);bp.topMargin=dp(14);card.addView(pair,bp);
    TextView note=text("Le code expire en cinq minutes et ne sert qu’une fois. Après l’association, le badge est généré sur le téléphone sans connexion Internet.",12,MUTED,false);note.setLineSpacing(dp(3),1);LinearLayout.LayoutParams np=lp(-1,-2);np.setMargins(dp(5),dp(16),dp(5),0);root.addView(note,np);
    TextView ver=text("PromedPara Worker · version "+appVersion(),11,MUTED,false);ver.setGravity(Gravity.CENTER);LinearLayout.LayoutParams vp=lp(-1,-2);vp.topMargin=dp(18);root.addView(ver,vp);
  }
  private String normalize(String raw){String value=raw.trim();if(!value.contains("://"))value="http://"+value;if(!value.matches("(?i)^https?://[^/]+(?::\\d+)?/?$"))return "";return value.replaceAll("/+$","");}
  private void enroll(TextView error){String base=normalize(serverField.getText().toString()),code=codeField.getText().toString().replaceAll("\\s","").toUpperCase(java.util.Locale.ROOT);if(base.isEmpty()||!code.matches("[A-F0-9]{12}")){error.setText("Vérifiez l’adresse et le code à 12 caractères.");return;}getPreferences(0).edit().putString("server",base).apply();error.setText("Association en cours…");
    io.execute(()->{try{JSONObject request=new JSONObject().put("code",code);Result result=request(base+"/api/worker/enroll",request.toString());JSONObject data=new JSONObject(result.body);if(result.status<200||result.status>=300)throw new Exception(data.optString("error","Association refusée."));String device=data.getString("deviceId"),seed=data.getString("secret"),name=data.optString("name","Employé");saveSeed(seed);getPreferences(0).edit().putString("server",base).putString("device",device).putString("name",name).apply();server=base;deviceId=device;workerName=name;secretHex=seed;runOnUiThread(this::showBadge);}catch(Exception e){runOnUiThread(()->error.setText(message(e)));}});
  }
  private void loadSaved(){server=getPreferences(0).getString("server","");deviceId=getPreferences(0).getString("device","");workerName=getPreferences(0).getString("name","");try{secretHex=loadSeed();}catch(Exception e){getPreferences(0).edit().remove("seed").remove("device").remove("name").apply();secretHex="";}}
  private void saveSeed(String hex)throws Exception{SecretKey key=getOrCreateKey();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);byte[] encrypted=cipher.doFinal(hex.getBytes(StandardCharsets.US_ASCII)),iv=cipher.getIV(),bundle=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,bundle,0,iv.length);System.arraycopy(encrypted,0,bundle,iv.length,encrypted.length);getPreferences(0).edit().putString("seed",Base64.encodeToString(bundle,Base64.NO_WRAP)).apply();}
  private String loadSeed()throws Exception{String stored=getPreferences(0).getString("seed","");if(stored.isEmpty())return "";byte[] bundle=Base64.decode(stored,Base64.NO_WRAP),iv=new byte[12],cipherText=new byte[bundle.length-12];System.arraycopy(bundle,0,iv,0,12);System.arraycopy(bundle,12,cipherText,0,cipherText.length);KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);SecretKey key=(SecretKey)ks.getKey(KEY_ALIAS,null);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv));return new String(cipher.doFinal(cipherText),StandardCharsets.US_ASCII);}
  private SecretKey getOrCreateKey()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(ks.containsAlias(KEY_ALIAS))return (SecretKey)ks.getKey(KEY_ALIAS,null);KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());return generator.generateKey();}
  private void showBadge(){if(secretHex.isEmpty()){showPair();return;}begin();getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);WindowManager.LayoutParams attributes=getWindow().getAttributes();attributes.screenBrightness=.92f;getWindow().setAttributes(attributes);
    // the phone only unlocks the session: a bare badge, no names, figures or explanations
    LinearLayout card=column();pad(card,14,14,14,14);card.setGravity(Gravity.CENTER);card.setBackground(shape(Color.WHITE,LINE,18));LinearLayout.LayoutParams cp=lp(-1,230);cp.topMargin=dp(70);root.addView(card,cp);barcodeView=new BarcodeView();card.addView(barcodeView,new LinearLayout.LayoutParams(-1,dp(190)));
    card.setOnLongClickListener(v->{new AlertDialog.Builder(this).setTitle("Déconnecter ce téléphone ?").setMessage("Le badge sera effacé de cet appareil. Si le téléphone est perdu, demandez aussi au propriétaire de le révoquer dans Comptes équipe.").setNegativeButton("Annuler",null).setPositiveButton("Déconnecter",(d,w)->clearPairing()).show();return true;});tick();
  }
  private void tick(){if(ticker!=null)handler.removeCallbacks(ticker);ticker=()->{if(secretHex.isEmpty()||barcodeView==null)return;try{long unix=System.currentTimeMillis()/1000L,step=unix/30;int remaining=(int)(30-unix%30);String code=totp(secretHex,step),payload="PP"+deviceId+code;barcodeView.setPayload(payload);}catch(Exception e){Toast.makeText(this,"Impossible de générer le badge.",Toast.LENGTH_LONG).show();}handler.postDelayed(ticker,1000);};handler.post(ticker);}
  private String totp(String hex,long step)throws Exception{byte[] key=new byte[hex.length()/2];for(int i=0;i<key.length;i++)key[i]=(byte)Integer.parseInt(hex.substring(i*2,i*2+2),16);byte[] counter=new byte[8];for(int i=7;i>=0;i--){counter[i]=(byte)(step&0xff);step>>>=8;}Mac mac=Mac.getInstance("HmacSHA1");mac.init(new SecretKeySpec(key,"HmacSHA1"));byte[] digest=mac.doFinal(counter);int offset=digest[digest.length-1]&15;long value=((digest[offset]&0x7fL)<<24)|((digest[offset+1]&0xffL)<<16)|((digest[offset+2]&0xffL)<<8)|(digest[offset+3]&0xffL);return String.format(java.util.Locale.US,"%06d",value%1_000_000L);}
  private void clearPairing(){getPreferences(0).edit().remove("seed").remove("device").remove("name").apply();secretHex="";deviceId="";workerName="";showPair();}
  private String message(Exception e){return e.getMessage()==null?"Connexion impossible.":e.getMessage();}
  private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
  private static Result request(String address,String json)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setRequestMethod("POST");c.setConnectTimeout(9000);c.setReadTimeout(15000);c.setRequestProperty("Content-Type","application/json; charset=utf-8");c.setRequestProperty("Accept","application/json");c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write(json.getBytes(StandardCharsets.UTF_8));}int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream();if(in!=null){byte[] buffer=new byte[2048];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);in.close();}String body=new String(out.toByteArray(),StandardCharsets.UTF_8);c.disconnect();return new Result(status,body);}
  private static final class Result{final int status;final String body;Result(int s,String b){status=s;body=b;}}
  private final class BarcodeView extends View{
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private String payload="";
    BarcodeView(){super(MainActivity.this);setLayerType(View.LAYER_TYPE_SOFTWARE,null);}
    void setPayload(String value){if(!value.equals(payload)){payload=value;invalidate();}}
    @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);canvas.drawColor(Color.WHITE);if(payload.isEmpty())return;String chars="*"+payload+"*";float units=24;for(int i=0;i<chars.length();i++){int p=pattern(chars.charAt(i));for(int j=0;j<9;j++)units+=((p>>(8-j))&1)==1?3:1;if(i<chars.length()-1)units+=1;}float scale=Math.min(getWidth()/units,dp(1.8f)),x=(getWidth()-units*scale)/2f,top=dp(5),bottom=getHeight()-dp(5);paint.setColor(Color.rgb(20,35,26));for(int i=0;i<chars.length();i++){int p=pattern(chars.charAt(i));for(int j=0;j<9;j++){float w=(((p>>(8-j))&1)==1?3:1)*scale;if(j%2==0)canvas.drawRect(x,top,x+w,bottom,paint);x+=w;}if(i<chars.length()-1)x+=scale;}}
    private int pattern(char c){if(c=='*')return 0x094;int index=CODE39.indexOf(c);return index<0?0:ENCODINGS[index];}
  }
}
