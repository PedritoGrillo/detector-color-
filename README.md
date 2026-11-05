# Muestrario · Detector de color

Aplicación web para sacar el color de una foto y encontrar su equivalencia más cercana en
**RAL Classic** y **Pantone** (aproximado).

## Qué hace

- **Sube una foto** (o hazla con el móvil), arrástrala o pégala con <kbd>Ctrl</kbd>+<kbd>V</kbd>.
- **Toca el punto** que quieres medir. Manteniendo pulsado aparece una **lupa** para afinar.
  El tamaño de la muestra se puede elegir (1 px, 5×5, 11×11, 21×21) para promediar el ruido de la foto.
- **Corregir luz**: tocas algo que en la realidad sea blanco o gris (un papel, una pared) y la
  aplicación quita el tono que mete la luz (amarillenta, azulada…). Mejora mucho el resultado.
- **Colores principales**: al cargar la foto saca automáticamente los colores dominantes.
- **Equivalencias en abanico**: las 3 cartas RAL y las 3 Pantone más parecidas, como una carta de
  colores de verdad, con la diferencia de color **ΔE 2000**:
  | ΔE | Qué significa |
  |---|---|
  | < 1 | Idéntico a la vista |
  | 1 – 2,5 | Casi idéntico |
  | 2,5 – 5 | Muy parecido |
  | 5 – 10 | Parecido |
  | > 10 | Lejano |
- Valores HEX, RGB, CMYK, HSL y Lab, con botón de copiar.
- **Mi paleta**: guarda los colores medidos en el navegador y cópialos de golpe.

Todo funciona en el navegador: las fotos **no se suben a ningún servidor**.

## Usarla

Publicada con GitHub Pages. Para probarla en local hace falta un servidor estático (los módulos JS
no cargan con `file://`), por ejemplo:

```bash
npx serve .
```

## Avisos

- El color de una foto depende de la cámara, la luz y la pantalla. Úsalo como orientación y
  confirma siempre con la carta física.
- Los valores **Pantone** son equivalencias aproximadas publicadas por terceros, **no** datos
  oficiales de Pantone LLC. PANTONE® y RAL® son marcas de sus respectivos propietarios.

## Datos de color

- RAL Classic: paquete npm [`ral-colors`](https://www.npmjs.com/package/ral-colors) (MIT, Ibon Eskudero).
- Pantone aproximado: paquete npm [`pantone-colors`](https://www.npmjs.com/package/pantone-colors)
  (MIT, Tran Sang), valores de pantone-colours.com.

## Licencia

MIT
