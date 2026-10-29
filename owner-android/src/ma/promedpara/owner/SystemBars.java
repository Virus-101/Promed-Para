package ma.promedpara.owner;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.InsetDrawable;
import android.view.View;
import android.view.Window;

/** Android 15 draws apps edge to edge: keep the content below the status bar, paint the strip in the header colour and use light icons on it. */
final class SystemBars {
    private SystemBars() {}

    static void apply(final Activity activity, final int stripColor, final int bodyColor) {
        Window window = activity.getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        final View decor = window.getDecorView();
        decor.setBackgroundColor(stripColor);
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        final View content = activity.findViewById(android.R.id.content);
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = insets.getSystemWindowInsetTop();
            content.setPadding(0, top, 0, 0);
            content.setBackground(new InsetDrawable(new ColorDrawable(bodyColor), 0, top, 0, 0));
            return v.onApplyWindowInsets(insets);
        });
        decor.requestApplyInsets();
    }
}
